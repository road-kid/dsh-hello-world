/**
 * Client bundle of the quick-terminal component package (`dsh-quick-terminal`).
 *
 * A single action in the settings header. The page's module loader registers this
 * bundle when the package's row is enabled and unloads it when the row is
 * switched off, so the bundle's own presence is the primary availability signal.
 * The action is therefore painted with the header's first commit, beside the
 * actions the Host ships, and never waits for a round trip: a probe may only
 * *hide* it, and only when the Host answers that the component is gone. A Host
 * that is merely unreachable — a restart in progress — leaves the action in place
 * and reports the failure on click, which is where a person can act on it. There
 * is deliberately no timer: availability is not a quantity that changes while
 * this component stays mounted, and polling for it made the button flicker
 * whenever the Host happened to be restarting.
 *
 * Nothing here imports another plugin's DOM, and the only runtime modules are
 * React (external) and the controls this repository renders itself.
 */

import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import { fetchTerminalStatus, openTerminal } from '../client/api.ts'
import { service } from '../client/service.ts'
import { installBaseStyles } from '../client/styles.ts'
import { Button } from '../client/ui/button.tsx'
import { Modal } from '../client/ui/modal.tsx'
import type { ClientContext, Dictionary, LocaleService, SlotsService, Translate } from '../client/types.ts'

/** Component name; must be unique across plugins. */
export const name = 'quick-terminal'

/** Locale namespace of this package; must be unique across plugins. */
const LOCALE_NAMESPACE = 'dsh-quick-terminal'

/** The settings-header action seat. */
const SETTINGS_ACTION_SLOT = 'settings.action'

/** Stable id: a duplicate registration at the same priority throws. */
const SETTINGS_ACTION_ID = 'open-terminal'

/** Ordering within the settings header list. */
const SETTINGS_ACTION_ORDER = 100

const zh: Dictionary = {
  'terminal.action': '打开 DSH 终端',
  'terminal.error': '无法打开终端：{error}',
  'terminal.missing.title': '无法打开 DSH 终端',
  'terminal.missing.body': '没有找到可用的终端程序',
  'terminal.missing.tried': '已尝试：{tried}',
  'terminal.missing.fix': '请安装上述任一终端程序后重试',
  'terminal.missing.dismiss': '关闭',
}

const en: Dictionary = {
  'terminal.action': 'Open DSH terminal',
  'terminal.error': 'Could not open a terminal: {error}',
  'terminal.missing.title': 'Could not open a DSH terminal',
  'terminal.missing.body': 'No terminal program was found',
  'terminal.missing.tried': 'Tried: {tried}',
  'terminal.missing.fix': 'Install one of these terminal programs and try again',
  'terminal.missing.dismiss': 'Close',
}

interface TerminalActionProps {
  readonly t: Translate
}

/**
 * Render the action.
 *
 * @param props.t - translator bound to this package's locale namespace.
 * @returns the button; nothing only once the Host confirms the component is off.
 */
function TerminalAction({ t }: TerminalActionProps): ReactElement | null {
  const [busy, setBusy] = useState(false)
  // Optimistic on purpose: the settings header's first commit must already carry
  // this action, exactly like the actions the Host ships beside it. The probe can
  // only ever take it away, and only on a definitive answer.
  const [gone, setGone] = useState(false)
  const [failure, setFailure] = useState<{ text: string; missing: boolean; tried: string } | undefined>(undefined)

  useEffect(() => {
    let alive = true
    // Availability is sampled when the action appears and when the page comes
    // back into view: the two moments a stale answer could have been kept. Only
    // `unavailable` — the Host saying this component's route is not mounted —
    // hides the action. `unknown` means the Host did not answer at all, which is
    // what a restart looks like from here, so the button stays and the click
    // reports whatever is wrong.
    const probe = (): void => {
      void fetchTerminalStatus().then((answer) => {
        if (alive) setGone(answer === 'unavailable')
      })
    }
    probe()
    const revalidate = (): void => {
      if (!document.hidden) probe()
    }
    document.addEventListener('visibilitychange', revalidate)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', revalidate)
    }
  }, [])

  if (gone) return null

  const open = (): void => {
    if (busy) return
    setBusy(true)
    setFailure(undefined)
    void openTerminal()
      .then((response) => {
        setBusy(false)
        if (response.ok) return
        const tried = response.tried ?? []
        setFailure({
          text: t('terminal.error', { error: response.error ?? 'unknown' }),
          missing: response.failure === 'no-terminal',
          tried: tried.length === 0 ? '\u2014' : tried.join(', '),
        })
      })
      .catch((cause: unknown) => {
        setBusy(false)
        setFailure({
          text: t('terminal.error', { error: cause instanceof Error ? cause.message : String(cause) }),
          missing: false,
          tried: '\u2014',
        })
      })
  }

  return (
    <>
      <Button variant="outline" size="sm" disabled={busy} onClick={open}>
        {t('terminal.action')}
      </Button>
      {failure !== undefined && (
        <Modal
          open
          onClose={() => { setFailure(undefined) }}
          title={t('terminal.missing.title')}
          closeLabel={t('terminal.missing.dismiss')}
          footer={(
            <Button variant="primary" data-modal-autofocus onClick={() => { setFailure(undefined) }}>
              {t('terminal.missing.dismiss')}
            </Button>
          )}
        >
          <div className="dh-dialog-body">
            <span>{failure.missing ? t('terminal.missing.body') : failure.text}</span>
            {failure.missing && (
              <>
                <span>{t('terminal.missing.tried', { tried: failure.tried })}</span>
                <span>{t('terminal.missing.fix')}</span>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}

/**
 * Mount the client half.
 *
 * @param ctx - client context of this plugin entry.
 */
export function apply(ctx: ClientContext): void {
  // The shared primitives: this bundle renders a button and a dialog, the same
  // primitives the restart bundle installs. The sheet is reference-counted on the
  // document, so whichever package is left mounted keeps it installed.
  ctx.effect(() => installBaseStyles(document), 'dsh-hello-world: ui stylesheet')

  const slots = service<SlotsService>(ctx, 'slots')
  if (slots === undefined) return

  const locale = service<LocaleService>(ctx, 'locale')
  if (locale !== undefined) {
    ctx.effect(() => {
      try {
        return locale.register(LOCALE_NAMESPACE, { zh, en })
      } catch {
        // A namespace already registered under this name (after hot reload) is not
        // an error: keep the existing dictionary.
        return () => {}
      }
    }, 'dsh-hello-world: terminal locale')
  }

  const t: Translate = locale?.bind(LOCALE_NAMESPACE) ?? ((key: string) => key)

  ctx.effect(() => {
    let dispose: (() => void) | undefined
    const off = slots.inject(SETTINGS_ACTION_SLOT, () => {
      dispose = slots.register<TerminalActionProps>(
        {
          name: SETTINGS_ACTION_SLOT,
          id: SETTINGS_ACTION_ID,
          order: SETTINGS_ACTION_ORDER,
          locale: LOCALE_NAMESPACE,
          label: t('terminal.action'),
          inject: () => ({ t }),
        },
        TerminalAction,
      )
      return () => {
        dispose?.()
        dispose = undefined
      }
    })
    return () => {
      dispose?.()
      dispose = undefined
      off()
    }
  }, 'dsh-hello-world: terminal settings action')
}

/** Hard dependencies of the browser half. */
export const inject = ['slots', 'locale']
