/**
 * Restart from the settings header.
 *
 * The restart button sits in `settings.action`, the content-column header seat
 * the shell opens for a settings pane — beside “Open DSH terminal” and before
 * the pane's own Close button. That is a slot the shell already allocates space
 * for, so nothing here writes DOM into a shell component.
 *
 * Everything the runtime offers is used the official way: the seat is declared by
 * `ctx.slots.inject` + `ctx.slots.register` inside an effect, strings go through
 * the locale service, the shared stylesheet is installed from an effect, and the
 * controller — with the background watch it depends on — is unloaded together
 * with the plugin.
 */

import type { ReactElement } from 'react'

import { DICTIONARIES, LOCALE_NAMESPACE } from './locales.ts'
import { RestartActionButton } from './restart-action.tsx'
import type { RestartActionProps } from './restart-action.tsx'
import { service } from './service.ts'
import { loadRestart, watchRestart } from './store.ts'
import { installBaseStyles } from './styles.ts'
import type { ClientContext, LocaleService, SlotRegistration, SlotsService, Translate } from './types.ts'

/** Component name; must be unique across plugins. */
export const name = 'quick-restart'

/** Services this component needs before it can register. */
export const inject = ['slots', 'locale']

/** The settings header seat; the shell renders its actions before Close. */
const SETTINGS_ACTION_SLOT = 'settings.action'

/** Registration id inside the settings header seat. */
const SETTINGS_ACTION_ID = 'restart'

/** Order inside `settings.action`; ascending, so this sits right of the terminal. */
const SETTINGS_ACTION_ORDER = 110

/** One seat to fill: where, how to order it, and what to render there. */
interface SeatOptions<P> {
  /** Seat name, e.g. `settings.action`. */
  readonly slot: string
  /** Registration id inside the seat; unique across plugins. */
  readonly id: string
  /** Ordering hint inside the seat; ascending renders left to right. */
  readonly order: number
  /** Human label shown by tooling; a thunk tracks the active locale. */
  readonly label: string | (() => string)
  /** Component to render in the seat; `t` arrives from the framework locale seat. */
  readonly component: (props: P) => ReactElement | null
  /** Effect label in the runtime's inspector. */
  readonly effectLabel: string
}

/**
 * Seat one component through the official slot pipeline.
 *
 * The registration lives in the same effect as the injection that scopes it, so
 * unloading the declaration also withdraws the registration.
 *
 * @param ctx - client context that owns the effect.
 * @param slots - slot service.
 * @param options - seat coordinates and the component to render there.
 */
function seat<P>(ctx: ClientContext, slots: SlotsService, options: SeatOptions<P>): void {
  const { slot, id, order, label, component, effectLabel } = options
  // No `inject` face: the component reads `t` from the framework's locale seat,
  // which the renderer mints afresh per revision. Shadowing that seat with a
  // stable `bind()` reference would freeze memoised derivations on the previous
  // language — the exact bug this registration avoids.
  const registration: SlotRegistration = {
    name: slot,
    id,
    order,
    locale: LOCALE_NAMESPACE,
    label,
  }
  ctx.effect(() => {
    let dispose: (() => void) | undefined
    const off = slots.inject(slot, () => {
      dispose = slots.register<P>(registration, component)
      return () => { dispose?.() }
    })
    return () => {
      dispose?.()
      off()
    }
  }, effectLabel)
}

/**
 * Apply the component.
 *
 * @param ctx - client context of this component.
 */
export function apply(ctx: ClientContext): void {
  // One shared stylesheet: the terminal bundle installs the same one, and the
  // document-level count keeps it up while either bundle still renders with it.
  ctx.effect(() => installBaseStyles(document), 'dsh-hello-world: ui stylesheet')

  const slots = service<SlotsService>(ctx, 'slots')
  if (slots === undefined) return

  let t: Translate = key => key
  const locale = service<LocaleService>(ctx, 'locale')
  if (locale !== undefined) {
    ctx.effect(() => locale.register(LOCALE_NAMESPACE, DICTIONARIES), 'dsh-hello-world: restart locale')
    t = locale.bind(LOCALE_NAMESPACE)
  }

  seat<RestartActionProps>(ctx, slots, {
    slot: SETTINGS_ACTION_SLOT,
    id: SETTINGS_ACTION_ID,
    order: SETTINGS_ACTION_ORDER,
    label: () => t('action.restart'),
    component: RestartActionButton,
    effectLabel: 'dsh-hello-world: restart settings action',
  })

  // The first read fills the snapshot; the watch keeps it honest afterwards.
  // Both live in effects, so switching the plugin off stops the interval and
  // removes its `visibilitychange` listener with everything else — an interval
  // that outlived the component would keep posting to a route that no longer
  // exists for as long as the page stays open.
  ctx.effect(() => watchRestart(), 'dsh-hello-world: restart watch')
  void loadRestart()
}
