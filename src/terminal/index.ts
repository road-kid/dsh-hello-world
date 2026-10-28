import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'

import { messageOf } from '../diag.ts'
import type { TerminalFailure } from '../shared/protocol.ts'
import { type TerminalBanner } from './banner.ts'
import {
  homeOfProfile,
  resolveDeployment,
  resolveIdentity,
  resolveInstallationRoot,
  terminalDirectory,
  terminalHome,
  terminalProfile,
  type TerminalContext,
} from './identity.ts'
import { type TerminalPlan, terminalPlan } from './plan.ts'
import { prepareTerminalShim, pruneLegacyScripts, terminalEnvironment, type Shim } from './shim.ts'

/**
 * Open a terminal in the Host's profile directory.
 *
 * The window is a plain PowerShell (or the user's shell on macOS/Linux) in which
 * `dsh` works **without** `--profile`, the way the deployment's own terminal
 * behaves: a private per-profile shim directory is generated on every launch,
 * prepended to `PATH`, and its `dsh` command forwards to the installation's own
 * carrier CLI — the one that carries the bundled pnpm and may manage the reserved
 * `desktop` profile. Everything else (a second copy of the host, a pnpm outside
 * the installation) is deliberately not touched. See `shim.ts` for the launcher
 * and `identity.ts` for how the installation is found.
 *
 * This module is the assembly, and the only place here with side effects: it
 * decides where the terminal opens, builds the plan (`plan.ts`) and starts it.
 *
 * Three directories meet here, and the banner prints two of them. `DSH home` is the
 * directory that holds every profile, `Directory` is where the running DSH lives —
 * the installation directory of a packaged app, the checkout root of a source run —
 * which is the one thing about the environment a user cannot otherwise see. The
 * profile directory itself is not printed, because it is `DSH home` + `profiles` +
 * `Profile`; the shell still starts there, because that is where `dsh plugin` work
 * happens.
 *
 * ## Why a shim and not a documented flag
 *
 * The released CLI requires `--profile` on every plugin command
 * (`requiredOption`), and the `desktop` profile is rejected by boot/dump paths.
 * The deployment's carrier lifts the plugin restriction only when it runs as the
 * desktop CLI, so the terminal must invoke exactly that entry point with the
 * profile filled in. A generated launcher keeps the printed documentation clean —
 * the banner advertises the installation-owned commands, not the flags this
 * plugin had to add for it.
 *
 * ## Environment
 *
 * The Host runs as `DeepSeek Harness.exe` with `ELECTRON_RUN_AS_NODE=1`; a shell
 * that inherited that variable would break every Electron binary started from it,
 * so the terminal environment is the Host's environment minus that one variable,
 * plus `DSH_HOME` and the shim directory. `launch` hands the plan's environment to
 * the child; the welcome script repeats the PATH edit inside the shell for shells
 * that re-read the environment.
 *
 * ## Failure accounting
 *
 * Nothing here throws. A missing shell, an unwritable temporary directory, or a
 * failed spawn comes back as `{ok:false, failure, error, tried}`, which the
 * settings action turns into a dialog; the Host never learns a terminal was
 * wanted. The spawn result is awaited rather than fire-and-forget, because
 * `ENOENT` and `EACCES` arrive as an asynchronous `error` event — reporting
 * `{ok:true}` for a window that never appeared is the one failure a user cannot
 * diagnose from the outside.
 */

/** The outcome of an opened terminal. */
export interface TerminalResult {
  readonly ok: boolean
  readonly error?: string
  readonly failure?: TerminalFailure
  readonly tried?: readonly string[]
  readonly directory?: string
}

/** How long a spawn may stay silent before the window is assumed to have opened. */
const SPAWN_TIMEOUT_MS = 2_000

/**
 * Start one plan, detached, so the window survives the plugin and the Host.
 *
 * The result is awaited: a caller that only wrapped `spawn` in a try/catch would
 * report success while no window ever appeared.
 *
 * @param plan - the resolved plan.
 * @returns whether the child started, or why it did not.
 */
function launch(plan: TerminalPlan): Promise<{ readonly ok: boolean; readonly error?: string }> {
  return new Promise(resolve => {
    let settled = false
    let timer: NodeJS.Timeout | undefined
    const finish = (result: { readonly ok: boolean; readonly error?: string }): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      resolve(result)
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(plan.file, [...plan.args], {
        cwd: plan.cwd,
        env: plan.env ?? process.env,
        detached: true,
        stdio: 'ignore',
        windowsHide: plan.hideWindow,
      })
    } catch (error) {
      finish({ ok: false, error: messageOf(error) })
      return
    }
    // The window must outlive the Host, so the handle never keeps this process alive.
    child.unref()
    child.once('spawn', () => finish({ ok: true }))
    child.once('error', error => finish({ ok: false, error: messageOf(error) }))
    timer = setTimeout(() => finish({ ok: true }), SPAWN_TIMEOUT_MS)
    timer.unref()
  })
}

/**
 * Open the terminal at the Host's profile directory.
 *
 * @param ctx - host context; `profileContext` names the profile when bound.
 * @param environment - the Host environment; overridable for tests.
 * @param platform - target platform; overridable for tests.
 * @param tmp - temporary directory root; overridable for tests.
 * @returns success with the directory the terminal opened in, or the failure the
 *   dialog shows.
 */
export async function openTerminal(
  ctx: TerminalContext,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  tmp: string = tmpdir(),
): Promise<TerminalResult> {
  const profileDirectory = terminalDirectory(ctx, environment)
  const profile = terminalProfile(ctx, environment)
  // `DSH_HOME` when the Host publishes it; otherwise read off the profile
  // directory itself, which is `<home>/profiles/<name>` by construction.
  const home = terminalHome(environment) ?? homeOfProfile(profileDirectory)
  const identity = resolveIdentity(process.execPath, process.argv)
  const deployment = resolveDeployment(process.execPath)
  // Falls back to the profile directory so the line is never empty when nothing
  // names an installation, as in a bare Node process.
  const applicationDirectory = resolveInstallationRoot(process.execPath, process.argv) ?? profileDirectory

  let shim: Shim | undefined
  if (deployment !== undefined) {
    try {
      shim = prepareTerminalShim(deployment, profile, tmp)
    } catch (error) {
      return { ok: false, failure: 'script', error: `could not write the dsh shim: ${messageOf(error)}` }
    }
  }

  pruneLegacyScripts(tmp)
  const childEnvironment = terminalEnvironment(environment, { home, shim })
  const banner: TerminalBanner = {
    profileDirectory,
    applicationDirectory,
    home,
    profile,
    hostPid: process.pid,
    product: identity?.product,
    version: identity?.version,
  }
  const planned = terminalPlan(banner, platform, childEnvironment, tmp, shim)
  if (!planned.ok) return { ok: false, failure: planned.failure, error: planned.error, tried: planned.tried }
  const plan = planned.plan
  if (plan === undefined) return { ok: false, failure: 'launch', error: 'the terminal plan is empty' }

  const launched = await launch(plan)
  if (!launched.ok) return { ok: false, failure: 'launch', error: launched.error, directory: profileDirectory }
  return { ok: true, directory: profileDirectory }
}

export { LINUX_TERMINALS, isOnPath, powershellPath, psQuote, terminalPlan } from './plan.ts'
export { prepareTerminalShim, pruneLegacyScripts, shQuote, terminalEnvironment } from './shim.ts'
export {
  homeOfProfile,
  PRODUCT_NAME,
  resolveDeployment,
  resolveIdentity,
  resolveInstallationRoot,
  terminalDirectory,
  terminalHome,
  terminalProfile,
} from './identity.ts'
export { bannerLines, profileCommands } from './banner.ts'
export type { TerminalBanner } from './banner.ts'
export type { TerminalPlan, TerminalPlanResult } from './plan.ts'
export type { Deployment, ProductIdentity } from './identity.ts'
export type { Shim } from './shim.ts'
export type { TerminalContext } from './identity.ts'
export type { TerminalFailure } from '../shared/protocol.ts'
