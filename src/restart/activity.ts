import type { Context } from '@deepseek-ai/cordis'

import { UNKNOWN_ACTIVE_TASKS } from '../shared/protocol.ts'
import { type JobView } from './types.ts'

/**
 * Active-work detection.
 *
 * A restart tears down every running agent, queued turn and background job in
 * this Host. Refusing while such work exists is the safe default, so the
 * capability needs a count. The predicate is copied from the official desktop
 * quit inspection (`apps/desktop-host/src/update-tasks.ts`), which is the
 * harness's own answer to "what would quitting now interrupt?".
 *
 * When `agents` or `jobs` is unavailable the count is *unknown*, not zero:
 * reporting "no work" would be a lie, and the config option `refuseWhileBusy`
 * treats unknown as busy. `-1` is the wire value for unknown.
 */

/** Minimal shape of one live agent, as far as interruption matters. */
interface LiveAgent {
  readonly id?: unknown
  readonly status?: unknown
  readonly inbox?: { readonly nextTurn?: readonly unknown[]; readonly nextStep?: readonly unknown[] }
}

/** Minimal shape of the `jobs` service. */
interface JobsService {
  list(caller?: unknown): readonly JobView[]
}

/** Minimal shape of the `agents` service. */
interface AgentsService {
  list(): readonly LiveAgent[]
}

function isRunning(job: JobView): boolean {
  return job.status === 'running' || job.status === 'stopping'
}

function hasPendingWork(agent: LiveAgent): boolean {
  const nextTurn = agent.inbox?.nextTurn?.length ?? 0
  const nextStep = agent.inbox?.nextStep?.length ?? 0
  return agent.status === 'running' || nextTurn > 0 || nextStep > 0
}

/**
 * Count the pieces of work a restart would interrupt.
 *
 * The service lookups live inside the guard on purpose: `ctx.get` *throws* when a
 * service is not bound, and an escape from here would travel up through
 * `probeCapability` into the `/status` route and turn the whole capability probe
 * into a failure. A missing service is a known, explainable state ("unknown"),
 * not a probe error.
 *
 * @param ctx - host context used to look the work services up lazily.
 * @returns the count, or {@link UNKNOWN_ACTIVE_TASKS} when the services are absent.
 */
export function countActiveTasks(ctx: Context): number {
  try {
    const agents = ctx.get('agents') as AgentsService | undefined
    const jobs = ctx.get('jobs') as JobsService | undefined
    if (agents === undefined || jobs === undefined) return UNKNOWN_ACTIVE_TASKS
    const live = agents.list()
    let count = 0
    for (const agent of live) if (hasPendingWork(agent)) count += 1
    // Host-wide jobs (no caller) plus jobs owned by each live agent.
    const callers: unknown[] = [undefined, ...live.map(agent => agent.id)]
    for (const caller of callers) {
      for (const job of jobs.list(caller)) if (isRunning(job)) count += 1
    }
    return count
  } catch {
    return UNKNOWN_ACTIVE_TASKS
  }
}
