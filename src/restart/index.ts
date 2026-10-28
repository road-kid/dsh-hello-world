import type { Context } from '@deepseek-ai/cordis'

import type { ConfigShape } from '../config.ts'
import { logFile, messageOf, writeDiagnostic } from '../diag.ts'
import { type HelperPlan, HELPER_PLAN_VERSION } from '../shared/helper-plan.ts'
import {
  PLUGIN_VERSION,
  type ProfileContextView,
  type RestartCapability,
  type RestartPlanView,
  type RestartRefusal,
  type RestartState,
  type RestartTarget,
} from '../shared/protocol.ts'
import { HELPER_TAG, startHelper } from './helper.ts'
import { cliLaunch, describeLaunch, desktopLaunch, isOfficialDesktopHost, nodeExecutable } from './launch.ts'
import { decide, observe, type Refusal } from './policy.ts'
import type { AppExitView, WebServerView } from './types.ts'

/**
 * Restart orchestration.
 *
 * This module owns the decision ("may a restart happen, and what would it do?")
 * and nothing else: it reports a capability the row can render, and, when asked,
 * arms the detached watchdog and then asks this process to leave. The mechanics
 * of *how* the replacement is started live in `helper.ts`; how the command line is
 * reconstructed lives in `launch.ts`.
 */

/**
 * Live lifecycle state. It only moves forward — `idle` → `scheduled` →
 * `restarting` — and `restarting` already makes the capability refuse, so a
 * second click cannot arm a second watchdog.
 */
let currentState: RestartState = 'idle'

/** Read the live lifecycle state (also used by the routes module). */
export function restartState(): RestartState {
  return currentState
}

/** Read the resolved target without any side effect. */
export function restartTarget(
  environment: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
  profile: ProfileContextView | undefined = undefined,
): RestartTarget {
  if (isOfficialDesktopHost(environment, argv)) return 'desktop'
  if (profile?.name === 'desktop') return 'desktop'
  return 'cli'
}

/**
 * The profile context, or `undefined` when the service is absent.
 *
 * `ctx.get` throws for a service that is not bound. A probe that dies on a missing
 * service cannot explain itself, so an absent profile context degrades to "this is
 * a command-line deployment" instead.
 *
 * @param ctx - Host context.
 * @returns the profile view, when the Host runs under a profile.
 */
function profileContext(ctx: Context): ProfileContextView | undefined {
  try {
    return ctx.get('profileContext') as ProfileContextView | undefined
  } catch {
    return undefined
  }
}

/** The listening port of this Host, when it serves HTTP. */
function servingPort(ctx: Context): number | undefined {
  let webServer: WebServerView | undefined
  try {
    webServer = ctx.get('webServer') as WebServerView | undefined
  } catch {
    webServer = undefined
  }
  const port = webServer?.port
  return typeof port === 'number' && Number.isInteger(port) && port > 0 ? port : undefined
}

/** What one probe learns: the row's snapshot and the refusal behind it. */
export interface RestartProbe {
  /** The capability the row renders. */
  readonly capability: RestartCapability
  /** Why a restart is unavailable, or `undefined` when it may proceed. */
  readonly refusal: Refusal | undefined
}

/**
 * Sample the capability and the refusal from a *single* observation.
 *
 * The row and the refusing route answer the same question, so a request that needs
 * both must not sample twice: every observation walks `agents.list()` and
 * `jobs.list()` and re-reads the supervisor/debugger verdicts. One request, one
 * observation, one answer.
 *
 * The decision itself lives in `policy.ts`; this function adds only what the
 * snapshot needs to describe the action (target, command line, pids). `detail`
 * therefore always describes what a restart *would* do: a capability that cannot
 * act still explains the action it was asked about, while the reason it cannot
 * act travels separately in `reason`.
 *
 * @param ctx - Host context; the work services are read here.
 * @param config - one immutable config snapshot.
 * @returns the capability and, when one applies, the refusal that produced it.
 */
export function probeRestart(ctx: Context, config: ConfigShape): RestartProbe {
  const target = restartTarget(process.env, process.argv, profileContext(ctx))
  const shellPid = target === 'desktop' ? process.ppid : undefined
  const observed = observe(ctx, config, currentState)
  const refusal = decide(observed)

  const launch = target === 'desktop'
    ? desktopLaunch()
    : cliLaunch(process.argv, process.execArgv, undefined, undefined, servingPort(ctx))

  const capability: RestartCapability = {
    supported: refusal === undefined,
    target,
    managedBy: refusal?.managedBy ?? (target === 'desktop' ? 'desktop-shell' : 'dsh-hello-world'),
    ...(refusal === undefined ? {} : { reason: refusal.reason }),
    supervisor: observed.supervisor,
    debugger: observed.debugger,
    platform: process.platform,
    pid: process.pid,
    ...(shellPid === undefined ? {} : { shellPid }),
    activeTasks: observed.activeTasks,
    state: currentState,
    confirmBeforeRestart: config.confirmBeforeRestart,
    refuseWhileBusy: config.refuseWhileBusy,
    version: PLUGIN_VERSION,
    detail: target === 'desktop'
      ? `relaunch the desktop application (shell pid ${String(shellPid ?? '?')})`
      : 'replay the current command line',
    command: describeLaunch(launch),
    logFile: logFile(),
  }
  return { capability, refusal }
}

/**
 * Build the capability snapshot the row renders.
 *
 * @param ctx - Host context; the work services are read here.
 * @param config - one immutable config snapshot.
 * @returns the capability; use {@link probeRestart} when the refusal is needed too.
 */
export function probeCapability(ctx: Context, config: ConfigShape): RestartCapability {
  return probeRestart(ctx, config).capability
}

/** Why a restart request was refused, or `undefined` when it is allowed. */
export function refusalFor(ctx: Context, config: ConfigShape): { reason: RestartRefusal; error: string } | undefined {
  const refusal = decide(observe(ctx, config, currentState))
  return refusal === undefined ? undefined : { reason: refusal.reason, error: refusal.error }
}

/** Build the watchdog plan for the current deployment. */
export function buildPlan(ctx: Context, config: ConfigShape): HelperPlan {
  const target = restartTarget(process.env, process.argv, profileContext(ctx))
  const port = servingPort(ctx)
  const host = '127.0.0.1'
  const launch = target === 'desktop' ? desktopLaunch() : cliLaunch(process.argv, process.execArgv, undefined, undefined, port)
  const sharedLog = logFile()
  return {
    version: HELPER_PLAN_VERSION,
    target,
    hostPid: process.pid,
    ...(target === 'desktop' ? { shellPid: process.ppid } : {}),
    ...(port === undefined ? {} : { host, port }),
    launch,
    logFile: sharedLog,
    startDelayMs: Math.max(0, Math.trunc(config.delayMs)),
    waitTimeoutMs: Math.max(1_000, Math.trunc(config.waitTimeoutMs)),
    settleTimeoutMs: Math.max(1_000, Math.trunc(config.settleTimeoutMs)),
    platform: process.platform,
  }
}

/**
 * Tell the terminal that asked for the restart what happens to it.
 *
 * A command-line restart detaches the replacement, so the terminal returns to
 * its prompt while a new Host keeps running with no controlling terminal. The
 * line is written only for the web profile: a terminal UI Host draws on the same
 * stream and would be corrupted by it.
 */
function announceDetachedRestart(plan: HelperPlan, ctx: Context): void {
  if (plan.target !== 'cli') return
  const profile = profileContext(ctx)?.name
  if (profile !== 'web') return
  process.stdout.write(
    `dsh-hello-world: restarting; the replacement runs detached. `
    + `Its pid and stop command are in ${plan.logFile}\n`,
  )
}

/**
 * Arm the watchdog and leave.
 *
 * The HTTP answer must be written before this returns, so the caller awaits this
 * function and the *exit* happens on a timer: the delay in the plan is what gives
 * the response time to reach the page.
 *
 * @returns the plan view for the response.
 */
export function scheduleRestart(ctx: Context, config: ConfigShape): RestartPlanView {
  const plan = buildPlan(ctx, config)
  currentState = 'scheduled'
  const argvLine = describeLaunch(plan.launch)
  writeDiagnostic(
    `${HELPER_TAG}: scheduling ${plan.target} restart; pid=${String(plan.hostPid)} `
    + `shell=${String(plan.shellPid ?? '-')} port=${String(plan.port ?? '-')} command="${argvLine}"`,
  )
  const helper = startHelper(plan)
  announceDetachedRestart(plan, ctx)
  currentState = 'restarting'
  writeDiagnostic(`${HELPER_TAG}: armed helper pid=${String(helper.pid ?? '?')}; leaving`)

  // Leave *after* the answer is flushed. `appExit` is the launcher's bounded
  // shutdown (it disposes the tree gracefully); SIGTERM is the fallback, and the
  // watchdog kills this process anyway if it lingers.
  const leave = (): void => {
    const exit = ctx.get('appExit') as AppExitView | undefined
    if (typeof exit === 'function') {
      try {
        exit(0)
        return
      } catch (error) {
        writeDiagnostic(`${HELPER_TAG}: appExit failed: ${messageOf(error)}`)
      }
    }
    try {
      process.kill(process.pid, 'SIGTERM')
    } catch (error) {
      writeDiagnostic(`${HELPER_TAG}: SIGTERM self failed: ${messageOf(error)}`)
      process.exit(0)
    }
  }
  const timer = setTimeout(leave, Math.max(0, Math.trunc(config.delayMs)))
  timer.unref()

  return {
    target: plan.target,
    pid: plan.hostPid,
    ...(helper.pid === undefined ? {} : { helperPid: helper.pid }),
    command: argvLine,
    waits: plan.target === 'desktop'
      ? [`shell ${String(plan.shellPid ?? '?')}`, `host ${String(plan.hostPid)}`]
      : [...(plan.port === undefined ? [] : [`port ${String(plan.port)}`]), `host ${String(plan.hostPid)}`],
    logFile: plan.logFile,
  }
}

/** Node executable used by the watchdog; exported for diagnostics. */
export { nodeExecutable }
