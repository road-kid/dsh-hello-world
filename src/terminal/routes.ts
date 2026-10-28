import type { Context } from '@deepseek-ai/cordis'

import { messageOf, writeDiagnostic } from '../diag.ts'
import { json, mountRoutes } from '../shared/http.ts'
import {
  ROUTE_TERMINAL,
  ROUTE_TERMINAL_STATUS,
  type TerminalResponse,
  type TerminalStatusResponse,
} from '../shared/protocol.ts'
import { trustedLocalRequest } from '../restart/guards.ts'
import { openTerminal } from './index.ts'

/**
 * The terminal component's HTTP routes.
 *
 * `open` starts a new shell at the profile directory (it stops nothing), and
 * `status` answers whether this component is mounted - its client bundle renders
 * the settings action only while it is. Both refuse an untrusted origin: one of
 * them starts a shell.
 *
 * @param ctx - context that owns the routes (disposed with it).
 */
export function registerRoutes(ctx: Context): void {
  const open = async (request: Request): Promise<Response> => {
    const answer = (response: TerminalResponse): Response => json(response)
    if (!trustedLocalRequest(request)) {
      writeDiagnostic('terminal: refused a request from an untrusted origin')
      return answer({ ok: false, error: 'the request origin is not trusted by the Host' })
    }
    try {
      return answer(await openTerminal(ctx))
    } catch (error) {
      writeDiagnostic(`terminal: open failed: ${messageOf(error)}`)
      return answer({ ok: false, failure: 'launch', error: messageOf(error) })
    }
  }

  const status = async (request: Request): Promise<Response> => {
    const answer = (response: TerminalStatusResponse): Response => json(response)
    if (!trustedLocalRequest(request)) {
      return answer({ ok: false, error: 'the request origin is not trusted by the Host' })
    }
    return answer({ ok: true, available: true, platform: process.platform })
  }

  mountRoutes(ctx, 'terminal', [
    { path: ROUTE_TERMINAL, fetch: open },
    { path: ROUTE_TERMINAL_STATUS, fetch: status },
  ])
}
