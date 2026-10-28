/**
 * The restart action.
 *
 * The behaviour lives here once, so the button and the dialog/toast it owns
 * cannot diverge: read the capability, decide whether the confirmation dialog is
 * needed, post the restart, follow the Host that replaces it. The surface only
 * supplies markup.
 *
 * Locale: this hook takes `t` as a parameter and uses it as a memo key. The slot
 * seat hands a fresh `t` per locale revision, so a memoised `view`/`overlays`
 * recomputes on a language switch while unrelated re-renders stay cheap. It must
 * never be given a stable `bind()` reference (the old bug), or a switch would be
 * swallowed by the memo.
 *
 * The action has three states, and the label follows them: it restarts, it
 * reports progress, and — when the replacement Host never answers on this
 * address — it offers the reload that is the only remaining way forward. The
 * reload is not a separate control: it is the same action, in the one state where
 * restarting again cannot help. The label itself is derived in `entry-view.ts`
 * (`restartEntryView`) and returned here as `view`.
 *
 * The hook deliberately owns the `Modal` and `Toast` elements too, and hands
 * them back as part of the surface's own render. Both are fixed-position and
 * rendered in place, so the dialog escapes the pane's clipping without the
 * plugin writing anything outside its own component tree.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'

import { requestRestart } from './api.ts'
import { refusalText, restartEntryView } from './entry-view.ts'
import type { RestartEntryView } from './entry-view.ts'
import { Button } from './ui/button.tsx'
import { Modal } from './ui/modal.tsx'
import { Toast } from './ui/toast.tsx'
import {
  awaitRestartedHost,
  clearRestartUnconfirmed,
  markRestartPending,
  markRestartUnconfirmed,
  restartPending,
  restartSnapshot,
  restartUnconfirmed,
  setRestartCapability,
  subscribeRestart,
  subscribeRestartPending,
  subscribeUnconfirmed,
} from './store.ts'
import type { Translate } from './types.ts'
import type { RestartResponse } from '../shared/protocol.ts'

/** Reload the page; the only way to reach a Host listening on another address. */
export function reloadPage(): void {
  globalThis.location.reload()
}

/**
 * Monotonic notice counter.
 *
 * The notice is a React key: two notices raised in the same millisecond — a failed
 * request followed by its recovery, say — must still be two keys, so the counter
 * is explicit instead of borrowed from the clock.
 */
let noticeSeq = 0

/** One transient notice, with an optional trailing action. */
interface Notice {
  readonly seq: number
  readonly text: string
  /** Offer `刷新页面` after the sentence. */
  readonly reload?: boolean
}

/**
 * Copy for a request that did not produce a plan.
 *
 * A refusal is a reason the user can act on, so it reads exactly like the row's
 * own refusal. Only `failed` — the Host's catch-all, which carries no meaning of
 * its own — falls through to the error text, and only when the Host sent one:
 * a `reason` spliced into a translated sentence produces copy in the wrong
 * language, and a transport string (`HTTP 500`) is not user-actionable at all.
 *
 * @param t - translator bound to the plugin's locale namespace.
 * @param response - the refused answer.
 * @param supervisor - supervisor name the capability still knows, if any.
 * @returns the sentence to show in the toast.
 */
function failureNotice(
  t: Translate,
  response: RestartResponse,
  supervisor: string | null | undefined,
): string {
  const reason = response.reason
  if (reason !== undefined && reason !== 'failed') return refusalText(t, reason, supervisor)
  const error = response.error
  if (error !== undefined && error !== '') return t('toast.failed', { error })
  return t('reason.unknown')
}

/** Everything a surface needs to render one restart affordance. */
export interface RestartAction {
  /** Activate the row: open the dialog, restart straight away, or reload. */
  readonly activate: () => void
  /** Dialog + toast, to be rendered by the surface. */
  readonly overlays: ReactElement
  /** Label, refusal reason and disabled state for the surface's own control. */
  readonly view: RestartEntryView
}

/**
 * Build the restart action for one surface.
 *
 * @param t - translator bound to the plugin's locale namespace.
 * @returns the action and its overlays.
 */
export function useRestartAction(t: Translate): RestartAction {
  const snapshot = useSyncExternalStore(subscribeRestart, restartSnapshot, restartSnapshot)
  const stale = useSyncExternalStore(subscribeUnconfirmed, restartUnconfirmed, restartUnconfirmed)
  const pending = useSyncExternalStore(subscribeRestartPending, restartPending, restartPending)
  const [confirming, setConfirming] = useState(false)
  const [notice, setNotice] = useState<Notice | undefined>(undefined)
  const mounted = useRef(true)
  const inFlight = useRef(false)

  useEffect(() => {
    // StrictMode mounts, unmounts and remounts the same hook instance without
    // re-running the initializer, so the flag has to be restored here. Setting it
    // only at creation leaves the second mount reading `false`, and every later
    // notice — including the one that clears `Restarting…` — would be dropped.
    mounted.current = true
    return (): void => { mounted.current = false }
  }, [])

  const capability = snapshot.status === 'ready' ? snapshot.capability : undefined
  // Memoised on `t` on purpose. The slot seat hands a fresh `t` per locale
  // revision (the renderer mints a new reference on every language switch and
  // keeps it stable within one revision), so the pair below is the contract:
  // freshness rides the identity of `t`, and a memo keyed on it recomputes on a
  // switch while unrelated re-renders keep the object stable for memo children.
  // A component must therefore take the seat's `t`, never shadow it with its own
  // stable `bind()` face.
  const view = useMemo<RestartEntryView>(
    () => restartEntryView(t, capability, stale, pending),
    [capability, pending, stale, t],
  )

  const showNotice = useCallback((text: string, reload = false): void => {
    // The recovery loop outlives the surface that started it, so a late notice can
    // arrive after the row was unmounted. Dropping it here keeps every caller from
    // repeating the same guard.
    if (!mounted.current) return
    noticeSeq += 1
    setNotice({ seq: noticeSeq, text, reload })
  }, [])

  /** Post the restart, then keep reading the status route until another Host answers. */
  const perform = useCallback(async (): Promise<void> => {
    // One request per restart. The dialog's confirm button stays mounted while the
    // request is in flight, so a double click would post twice and start two
    // recovery loops that outlive each other and race for the toast.
    if (inFlight.current) return
    inFlight.current = true
    markRestartPending(true)
    try {
      const response = await requestRestart()
      if (!response.ok) {
        showNotice(failureNotice(t, response, capability?.supervisor))
        if (response.capability !== undefined) setRestartCapability(response.capability)
        return
      }
      // The pid that accepted the request is the one that has to disappear. The
      // plan carries it; the capability is the fallback when the plan omits it.
      const baselinePid = response.plan?.pid ?? capability?.pid
      markRestartUnconfirmed()
      showNotice(t('toast.scheduled'))
      const outcome = await awaitRestartedHost(baselinePid)
      if (outcome === 'reconnected') {
        clearRestartUnconfirmed()
        showNotice(t('toast.reconnected'))
        return
      }
      // The recovery loop gave up. Releasing the flag lets the background watch
      // take over again: that watch is what notices a replacement Host coming up
      // on this address later, so holding the flag here would freeze both pollers
      // and leave the page on `Reload` until a manual refresh. The toast keeps
      // offering the reload in the meantime.
      clearRestartUnconfirmed()
      showNotice(t('toast.timeout'), true)
    } catch {
      // A transport failure is usually the expected one: the Host disappeared
      // before the answer could be read, which is exactly what a restart does.
      showNotice(t('toast.unreachable'))
    } finally {
      inFlight.current = false
      markRestartPending(false)
    }
  }, [capability?.pid, capability?.supervisor, showNotice, t])

  const activate = useCallback((): void => {
    if (stale) {
      reloadPage()
      return
    }
    if (capability === undefined || !capability.supported || pending) return
    if (capability.confirmBeforeRestart) {
      setConfirming(true)
      return
    }
    void perform()
  }, [capability, pending, perform, stale])

  // Same contract as `view`: keyed on the seat's `t`, so an open dialog or toast
  // follows a language switch without being rebuilt on unrelated re-renders.
  const overlays = useMemo((): ReactElement => {
    const command = capability?.command
    const busyNote = capability === undefined
      ? undefined
      : capability.activeTasks === 1
        ? t('dialog.busy.one')
        : capability.activeTasks > 0
          ? t('dialog.busy', { count: capability.activeTasks })
          : capability.activeTasks === 0
            ? t('dialog.busy.none')
            : t('dialog.busy.unknown')
    return (
      <>
        <Modal
          open={confirming}
          onClose={() => { setConfirming(false) }}
          title={t('dialog.title')}
          description={t('dialog.description')}
          closeLabel={t('dialog.close')}
          footer={(
            <>
              <Button variant="outline" onClick={() => { setConfirming(false) }}>{t('dialog.cancel')}</Button>
              <Button
                variant="primary"
                data-modal-autofocus
                disabled={pending}
                onClick={() => { setConfirming(false); void perform() }}
              >
                {t('dialog.confirm')}
              </Button>
            </>
          )}
        >
          <div className="dh-dialog-body">
            {/*
              One continuous paragraph: the interruption warning and the task
              count read as a single statement, the count on its own line right
              under the warning (hence `pre-line` and one text block, not two
              stacked elements with a gap between them).
            */}
            <p className="dh-dialog-text">
              {busyNote === undefined
                ? t('dialog.interrupt')
                : `${t('dialog.interrupt')}\n${busyNote}`}
            </p>
            {/*
              The command the restart runs, above the log: the two answers to
              "what will happen" and "where do I look if it does not". Both are
              facts from the capability, so the dialog never describes a plan the
              Host did not report.
            */}
            {command !== undefined && (
              <div className="dh-dialog-row">
                <span className="dh-dialog-label">{t('dialog.command.label')}</span>
                <code className="dh-dialog-command">{command}</code>
                <span className="dh-dialog-note">{t('dialog.command.note')}</span>
              </div>
            )}
            {capability?.logFile !== undefined && (
              <div className="dh-dialog-row">
                <span className="dh-dialog-label">{t('dialog.log.label')}</span>
                <code className="dh-dialog-command">{capability.logFile}</code>
                <span className="dh-dialog-note">{t('dialog.log.note')}</span>
              </div>
            )}
          </div>
        </Modal>
        {notice !== undefined && (
          <Toast
            key={notice.seq}
            text={notice.text}
            holdMs={notice.reload === true ? 10_000 : undefined}
            actions={notice.reload === true
              ? [{ label: t('action.reload'), prefix: ' ', onClick: reloadPage }]
              : undefined}
            onDone={() => { setNotice(undefined) }}
          />
        )}
      </>
    )
  }, [capability, confirming, notice, pending, perform, t])

  return { activate, overlays, view }
}
