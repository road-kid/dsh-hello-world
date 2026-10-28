import type { Context } from '@deepseek-ai/cordis'

import type { ConfigShape } from '../config.ts'
import { messageOf, writeDiagnostic } from '../diag.ts'
import { json, mountRoutes } from '../shared/http.ts'
import {
  ROUTE_RESTART,
  ROUTE_STATUS,
  type RestartCapability,
  type RestartResponse,
  type StatusResponse,
} from '../shared/protocol.ts'
import { trustedLocalRequest } from './guards.ts'
import { probeCapability, probeRestart, scheduleRestart } from './index.ts'

/**
 * The restart component's HTTP routes.
 *
 * `status` reports the capability and live state the row renders; `restart` arms
 * the detached watchdog. Both re-check the request origin as defence in depth:
 * a route that kills a process must also be safe in a deployment that mounts it
 * behind a proxy.
 *
 * The status route is a *polled* probe — the row asks every five seconds — so it
 * writes a diagnostic line only when the answer changes. Logging every poll would
 * fill the single rotated generation with heartbeats and push out the restart
 * evidence a support log exists for.
 *
 * @param ctx - context that owns the routes (disposed with it).
 * @param config - live configuration reader, so settings changes apply at once.
 */
export function registerRoutes(ctx: Context, config: () => ConfigShape): void {
  const status = async (): Promise<Response> => {
    const capability = probeCapability(ctx, config())
    const signature = statusSignature(capability)
    if (signature !== lastStatusSignature) {
      lastStatusSignature = signature
      writeDiagnostic(
        `status changed: supported=${String(capability.supported)} target=${capability.target} `
        + `reason=${capability.reason ?? '-'} state=${capability.state} `
        + `activeTasks=${String(capability.activeTasks)}`,
      )
    }
    const body: StatusResponse = { ok: true, capability }
    return json(body)
  }

  const restart = async (request: Request): Promise<Response> => {
    const answer = (response: RestartResponse): Response => json(response)
    if (!trustedLocalRequest(request)) {
      writeDiagnostic('routes: refused a restart request from an untrusted origin')
      return answer({ ok: false, reason: 'host', error: 'the request origin is not trusted by the Host' })
    }
    // One observation answers both "may this restart happen?" and "what does the
    // row say if it may not", so the refusal and the capability cannot disagree.
    const settings = config()
    const { capability, refusal } = probeRestart(ctx, settings)
    if (refusal !== undefined) {
      return answer({ ok: false, reason: refusal.reason, error: refusal.error, capability })
    }
    try {
      const plan = scheduleRestart(ctx, settings)
      return answer({ ok: true, plan })
    } catch (error) {
      writeDiagnostic(`routes: restart failed to arm: ${messageOf(error)}`)
      // Re-probe instead of reusing the pre-arm snapshot: arming moves the state
      // machine, so the stale snapshot would still claim the restart is available.
      return answer({ ok: false, reason: 'failed', error: messageOf(error), capability: probeCapability(ctx, settings) })
    }
  }

  mountRoutes(ctx, 'restart', [
    { path: ROUTE_STATUS, fetch: status },
    { path: ROUTE_RESTART, fetch: restart },
  ])
}

/**
 * Last capability signature written to the log, `undefined` before the first probe.
 *
 * Module-level on purpose: the log is one file shared by every mount, so the
 * comparison must survive an unmount/remount of the component (a switch that
 * changes nothing must not produce a line either).
 */
let lastStatusSignature: string | undefined

/**
 * The parts of a capability that make a log line worth writing.
 *
 * Deliberately excludes `command`, `detail` and `logFile`: they are constant for a
 * given deployment, so including them would make every poll look like a change.
 *
 * @param capability - the freshly probed capability.
 * @returns a stable one-line signature.
 */
function statusSignature(capability: RestartCapability): string {
  return [
    capability.supported ? 'supported' : 'refused',
    capability.target,
    capability.managedBy,
    capability.reason ?? '-',
    capability.state,
    String(capability.activeTasks),
    String(capability.pid),
    capability.supervisor ?? '-',
    capability.debugger ?? '-',
  ].join('|')
}
