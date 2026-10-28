import type { Context } from '@deepseek-ai/cordis'

import { messageOf, writeDiagnostic } from '../diag.ts'
import { logMount, logUnmount, type MountTag } from '../shared/mount.ts'
import { TERMINAL_PLUGIN_NAME } from '../shared/protocol.ts'
import { registerRoutes } from './routes.ts'

/**
 * dsh-quick-terminal - the quick-terminal component.
 *
 * A single action in the settings header that opens a new shell at the profile
 * directory, with the deployment's `dsh` on PATH and the Host pid printed above
 * the prompt. It never touches the running Host.
 *
 * The component is its own package so the plugin manager can give it a title and
 * a description separate from the restart component; the root package's bundle
 * patch declares both rows.
 */

export const name = 'quick-terminal'

/** Resolved lazily through `ctx.get`; a hard inject would keep the entry pending. */
export const inject: string[] = []

/** How this component signs its mount lines. */
const TAG: MountTag = { plugin: TERMINAL_PLUGIN_NAME, component: 'quick-terminal' }

/**
 * Mount the terminal component.
 *
 * @param ctx - host context of this plugin entry.
 */
export function apply(ctx: Context): void {
  logMount(TAG)
  try {
    registerRoutes(ctx)
  } catch (error) {
    // A route failure must not fail the mount, but it must not be silent either:
    // a component that mounted without its routes looks exactly like one the user
    // switched off, and only a diagnostic line tells those two apart.
    writeDiagnostic(`mount: terminal routes failed: ${messageOf(error)}`)
  }
  ctx.effect(() => () => {
    logUnmount(TAG)
  }, 'dsh-hello-world: terminal diagnostics')
}
