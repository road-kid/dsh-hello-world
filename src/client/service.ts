/**
 * One way to reach the runtime's service table.
 *
 * A client bundle may only require `react` from the browser module table; every
 * other dependency is looked up by name on the client context. `get` answers
 * `unknown` and a shell that does not provide a service may throw instead of
 * answering `undefined`, so both halves of the plugin go through this helper:
 * a missing service has to degrade one affordance, never fail the component that
 * owns the rest of the plugin.
 */

import type { ClientContext } from './types.ts'

/**
 * Look a service up without failing the component that needs it.
 *
 * @param ctx - client context.
 * @param name - service name as the runtime registers it.
 * @returns the service, or `undefined` when this shell does not provide it.
 */
export function service<T>(ctx: ClientContext, name: string): T | undefined {
  try {
    return ctx.get(name) as T | undefined
  } catch {
    return undefined
  }
}
