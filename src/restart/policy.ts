import type { Context } from '@deepseek-ai/cordis'

import type { ConfigShape } from '../config.ts'
import { UNKNOWN_ACTIVE_TASKS } from '../shared/protocol.ts'
import type { ManagedBy, RestartRefusal, RestartState } from '../shared/protocol.ts'
import { countActiveTasks } from './activity.ts'
import { detectedDebugger, detectedSupervisor } from './guards.ts'

/**
 * Restart policy: the ordered reasons a restart is unavailable right now.
 *
 * "Why can I not restart?" is two different questions:
 *
 * 1. *Is this deployment allowed to restart itself?* — a decision an operator
 *    made in the config (`enabled`, `allowSupervisor`, `refuseWhileBusy`).
 * 2. *Is the Host in a state that forbids it?* — an observation (a restart is
 *    already in flight, a debugger is attached, work is running).
 *
 * Both are answered by one ordered list because the capability the row renders
 * and the refusal the route returns must never disagree: the row explains itself
 * with the very sentence the request is refused with. Writing the precedence as
 * an array also makes it reviewable in one screen — the first matching rule wins,
 * so the order *is* the contract.
 *
 * Policy rules deliberately unmount nothing. The component switch in the plugin
 * manager is the lifecycle gate: it unloads the routes and the client bundle. A
 * policy rule leaves the capability readable, because that is the only way the
 * row can say "an operator turned this off" instead of silently vanishing, and a
 * route that refuses must still be able to explain why it refused.
 */

/** Everything a rule is allowed to look at, sampled once per decision. */
export interface Observation {
  readonly config: ConfigShape
  readonly state: RestartState
  readonly supervisor: string | null
  readonly debugger: string | null
  readonly activeTasks: number
}

/** A refusal, with the sentence that explains it to a person. */
export interface Refusal {
  readonly reason: RestartRefusal
  /** Set when a rule, not the deployment, decides who manages restarts. */
  readonly managedBy?: ManagedBy
  /** The sentence the route returns and the row translates. */
  readonly error: string
}

/** One reason a restart can be unavailable. */
interface Rule {
  readonly reason: RestartRefusal
  readonly managedBy?: ManagedBy
  readonly applies: (observed: Observation) => boolean
  readonly explain: (observed: Observation) => string
}

/**
 * Precedence, most authoritative first.
 *
 * `disabled` leads because an operator's decision outranks every observation.
 * `host` follows because a restart already in flight is a fact about this process
 * rather than about the deployment. `busy` is last because it is the only rule a
 * `--force` may override — every rule above it is absolute.
 */
const RULES: readonly Rule[] = [
  {
    reason: 'disabled',
    managedBy: 'operator',
    applies: observed => !observed.config.enabled,
    explain: () => 'restart is disabled by the plugin configuration',
  },
  {
    reason: 'host',
    applies: observed => observed.state !== 'idle',
    explain: () => 'a restart is already in progress',
  },
  {
    reason: 'supervisor',
    managedBy: 'operator',
    applies: observed => observed.supervisor !== null && !observed.config.allowSupervisor,
    explain: observed => `restart is managed by ${String(observed.supervisor)} (allowSupervisor is off)`,
  },
  {
    reason: 'debugger',
    // No `managedBy`: a debugger is a transient observation, not an operator's
    // policy, so the deployment still owns its own restarts.
    applies: observed => observed.debugger !== null,
    explain: () => 'a debugger is attached to the Host',
  },
  {
    reason: 'busy',
    applies: observed => observed.config.refuseWhileBusy && observed.activeTasks !== 0,
    explain: observed => observed.activeTasks === UNKNOWN_ACTIVE_TASKS
      ? 'the Host has work that cannot be inspected (agents/jobs services are unavailable)'
      : `the Host has ${String(observed.activeTasks)} active ${observed.activeTasks === 1 ? 'task' : 'tasks'}`,
  },
]

/** Cached verdict of {@link supervisor}: `undefined` until the first probe. */
let supervisorCache: string | null | undefined

/**
 * The supervisor verdict, probed once per process.
 *
 * `detectedSupervisor()` is built from environment variables and the parent pid,
 * neither of which can change while the process lives, so re-reading them on every
 * probe buys nothing — and this probe runs once per `/status` poll.
 *
 * `detectedDebugger()` is deliberately *not* cached here: `inspector.url()` changes
 * at runtime (a debugger may attach to a running Host through `SIGUSR1`, and the
 * desktop shell can open the inspector after startup), so caching it would silently
 * drop the `debugger` refusal exactly when someone is inspecting. It costs one
 * string read plus a regex over `execArgv` — nothing next to the `jobs.list()`
 * calls already in the same probe.
 *
 * @returns the supervising process, or `null` when the Host runs unattended.
 */
function supervisor(): string | null {
  if (supervisorCache === undefined) supervisorCache = detectedSupervisor()
  return supervisorCache
}

/**
 * Sample the facts one decision needs.
 *
 * @param ctx - Host context; the work services are read here.
 * @param config - one immutable config snapshot.
 * @param state - live lifecycle state.
 * @returns the observation the rules run against.
 */
export function observe(ctx: Context, config: ConfigShape, state: RestartState): Observation {
  return {
    config,
    state,
    supervisor: supervisor(),
    debugger: detectedDebugger(),
    activeTasks: countActiveTasks(ctx),
  }
}

/**
 * The first rule that applies.
 *
 * @param observed - one observation.
 * @returns the refusal, or `undefined` when a restart may proceed.
 */
export function decide(observed: Observation): Refusal | undefined {
  for (const rule of RULES) {
    if (!rule.applies(observed)) continue
    return {
      reason: rule.reason,
      ...(rule.managedBy === undefined ? {} : { managedBy: rule.managedBy }),
      error: rule.explain(observed),
    }
  }
  return undefined
}
