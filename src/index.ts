import type { Context } from '@deepseek-ai/cordis'

import { Config, snapshotConfig, type ConfigShape } from './config.ts'
import { messageOf, writeDiagnostic } from './diag.ts'
import { registerRestartCommand } from './restart/command.ts'
import { probeCapability, restartTarget } from './restart/index.ts'
import { registerRoutes } from './restart/routes.ts'
import { logMount, logUnmount, type MountTag } from './shared/mount.ts'
import { type ProfileContextView, RESTART_PLUGIN_NAME } from './shared/protocol.ts'

/**
 * dsh-hello-world — the restart component.
 *
 * A restart button in the settings header, right of the terminal action, plus a typed
 * `/restart` command. It is one of the two components of `dsh-hello-world`
 * (the other is `quick-terminal`), packaged separately so the plugin manager can
 * name, describe and switch each component on its own.
 *
 * Two deployments have to work, and they restart by different means:
 *
 * - **command line** (`dsh web`, a source checkout, any profile launched by the
 *   `dsh` launcher): this process owns its command line, so a detached watchdog
 *   waits for the port to be released and replays that command line;
 * - **official desktop app**: the Host is a child of the Electron shell, which
 *   exposes no plugin-facing relaunch channel, so the watchdog relaunches the
 *   whole application (and the shell starts a fresh Host).
 *
 * The host half owns the decision and the watchdog; the client half is a single
 * row that renders the capability this module reports. Nothing is registered as a
 * hard dependency, so a harness that drops a service degrades to "unsupported"
 * instead of failing to load.
 */

export const name = 'quick-restart'

/** Resolved lazily through `ctx.get`; a hard inject would keep the entry pending. */
export const inject: string[] = []

/** How this component signs its mount lines. */
const TAG: MountTag = { plugin: RESTART_PLUGIN_NAME, component: 'quick-restart' }

export { Config, snapshotConfig }
export type { ConfigShape } from './config.ts'

/**
 * The profile context, or `undefined` when the service is absent.
 *
 * `ctx.get` throws for a service that is not bound, and a mount log must never be
 * the thing that fails a mount: a Host without a profile context still gets its
 * restart component.
 *
 * @param ctx - host context of this plugin entry.
 * @returns the profile view, when the Host runs under a profile.
 */
function profileContext(ctx: Context): ProfileContextView | undefined {
  try {
    return ctx.get('profileContext') as ProfileContextView | undefined
  } catch {
    return undefined
  }
}

/**
 * Mount the plugin.
 *
 * @param ctx - host context of this plugin entry.
 * @param config - resolved configuration; the object is live, so settings edits
 * are visible to the next capability probe without a reload.
 */
export function apply(ctx: Context, config: unknown): void {
  logMount(TAG, `target=${restartTarget(process.env, process.argv, profileContext(ctx))}`)

  // The loader hands over the live config object; snapshotting on every read keeps
  // the settings form effective immediately without holding a stale copy.
  const read = (): ConfigShape => snapshotConfig(config)

  try {
    registerRoutes(ctx, read)
  } catch (error) {
    writeDiagnostic(`mount: routes failed: ${messageOf(error)}`)
  }

  try {
    registerRestartCommand(ctx, read)
  } catch (error) {
    writeDiagnostic(`mount: command failed: ${messageOf(error)}`)
  }

  ctx.effect(() => () => {
    logUnmount(TAG)
  }, 'dsh-hello-world: restart diagnostics')

  // Log the initial verdict once, so a support log explains the row's state even
  // when nobody opened the plugin settings.
  try {
    const capability = probeCapability(ctx, read())
    writeDiagnostic(
      `mount: capability supported=${String(capability.supported)} target=${capability.target} `
      + `reason=${capability.reason ?? '-'} activeTasks=${String(capability.activeTasks)} `
      + `supervisor=${capability.supervisor ?? '-'} debugger=${capability.debugger ?? '-'}`,
    )
  } catch (error) {
    writeDiagnostic(`mount: capability probe failed: ${messageOf(error)}`)
  }
}
