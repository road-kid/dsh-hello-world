/**
 * One view of the restart entry, shared by every surface that shows it.
 *
 * The action hook owns behaviour (dialog, request, reconnect), but the label and
 * the disabled state are presentation: they must read identically whether the
 * entry is rendered by React or built with the DOM. Keeping the derivation here
 * is what makes those two renderers impossible to diverge.
 */

import type { Translate } from './types.ts'
import type { RestartCapability, RestartRefusal } from '../shared/protocol.ts'

/** How one surface should present the entry right now. */
export interface RestartEntryView {
  /** Row label (`重启` / `刷新页面`). */
  readonly label: string
  /** Localized explanation when the entry cannot restart; also its aria copy. */
  readonly reason: string | undefined
  /** Whether the entry currently cannot be activated. */
  readonly disabled: boolean
}

/**
 * Localized copy explaining why a restart is refused.
 *
 * Takes the reason rather than a capability because two callers hold it
 * differently: the row reads it from the capability, while a refused request
 * reads it from the response and only knows the supervisor name from the
 * capability it still has.
 *
 * @param t - translator bound to the plugin's locale namespace.
 * @param reason - refusal the Host reported, if any.
 * @param supervisor - supervisor name the Host detected, when it named one.
 * @returns one short refusal sentence.
 */
export function refusalText(
  t: Translate,
  reason: RestartRefusal | undefined,
  supervisor?: string | null,
): string {
  switch (reason) {
    case 'disabled': return t('reason.disabled')
    case 'supervisor': {
      // The Host only names the supervisor when it could detect it; an unnamed
      // one gets its own sentence rather than a placeholder word spliced into a
      // translated one, which cannot be made grammatical in every language.
      return supervisor === undefined || supervisor === null || supervisor === ''
        ? t('reason.supervisor.unknown')
        : t('reason.supervisor', { name: supervisor })
    }
    case 'debugger': return t('reason.debugger')
    case 'busy': return t('reason.busy')
    case 'host': return t('reason.host')
    default: return t('reason.unknown')
  }
}

/**
 * Derive the entry's presentation from the shared state.
 *
 * @param t - translator bound to the plugin's locale namespace.
 * @param capability - capability, `undefined` until the Host has answered.
 * @param stale - whether a restart already moved the Host to another address.
 * @param pending - whether a restart from this page is still unresolved.
 * @returns label, refusal copy and disabled state.
 */
export function restartEntryView(
  t: Translate,
  capability: RestartCapability | undefined,
  stale: boolean,
  pending: boolean,
): RestartEntryView {
  // A posted restart outranks every other state: the recovery loop reports the
  // old Host as gone while it waits for the new one, so a stale check first would
  // flip the row to `Reload` in the middle of the restart it just started.
  if (pending) return { label: t('action.restarting'), reason: undefined, disabled: true }
  if (stale) return { label: t('action.reload'), reason: undefined, disabled: false }
  const label = t('action.restart')
  if (capability === undefined) return { label, reason: undefined, disabled: true }
  if (capability.supported) return { label, reason: undefined, disabled: false }
  return { label, reason: refusalText(t, capability.reason, capability.supervisor), disabled: true }
}
