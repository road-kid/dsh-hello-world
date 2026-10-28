import type { ReactElement } from 'react'

/**
 * Structural views of the client services this plugin uses.
 *
 * Loading a client bundle into the page is not a plugin-system negotiation: the
 * bundle may only require `react` from the browser module table, and everything
 * else is reached through the runtime's service table. These interfaces are
 * therefore declared structurally instead of imported from first-party packages —
 * a hard value import of a service package would break as soon as a release moves
 * it, and a Harness Client package may not be loaded as a module at all.
 */

/** Translation function bound to this plugin's locale namespace. */
export type Translate = (key: string, params?: Readonly<Record<string, string | number>>) => string

/** The locale service: registers this plugin's dictionaries and binds a translator. */
export interface LocaleService {
  register(namespace: string, dictionaries: { readonly zh: Dictionary; readonly en: Dictionary }): () => void
  bind(namespace: string): Translate
}

/** A flat key → text dictionary. */
export type Dictionary = Readonly<Record<string, string>>

/** Options accepted when seating one list-slot row. */
export interface SlotRegistration {
  readonly name: string
  readonly id: string
  readonly order?: number
  readonly label?: string | (() => string)
  readonly locale?: string
  readonly inject?: () => unknown
}

/** The slots service. `inject` runs the callback while the seat is available. */
export interface SlotsService {
  inject(name: string, callback: () => () => void): () => void
  /**
   * Seat a component. `P` is the props the registration's `inject` returns; the
   * runtime hands them straight to the component, so the pair is typed together
   * rather than through a cast at every call site.
   */
  register<P>(registration: SlotRegistration, component: (props: P) => ReactElement | null): () => void
}

/** Client-side context: the runtime guarantees `effect`, everything else is optional. */
export interface ClientContext {
  effect(body: () => () => void, label?: string): void
  get(name: string): unknown
}

/** Result of `GET`-ing the capability. */
export type { RestartCapability, RestartResponse } from '../shared/protocol.ts'
