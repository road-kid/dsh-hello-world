/**
 * Shared plumbing for the plugins' HTTP routes.
 *
 * Routes are registered on `ctx.connection.fetch`, the authenticated `/api`
 * channel: only this page's owner peer reaches an exact route; every other
 * principal gets 403 from the channel itself. Every route answers HTTP 200 with
 * `ok` in the body — a 4xx would reach the client as a bare `HTTP <status>` and
 * the reason would be lost.
 *
 * `connection` is provided by the client-connection plugin, which mounts on its
 * own schedule — often *after* these plugins. A lazy `ctx.get` at apply time
 * would therefore find nothing and the UI would never reach the Host, so the
 * registration runs inside `ctx.inject(['connection'])` and is disposed with the
 * entry.
 */

import type { Context } from '@deepseek-ai/cordis'

import { messageOf, writeDiagnostic } from '../diag.ts'

/** One exact route on the authenticated channel. */
export interface RouteSpec {
  readonly path: string
  readonly methods: readonly ('GET' | 'HEAD' | 'POST')[]
  readonly requestBody: 'buffered' | 'streaming'
  readonly fetch: (request: Request) => Promise<Response>
}

/** The slice of `ctx.connection` this module uses. */
interface ConnectionService {
  readonly fetch?: {
    register(route: RouteSpec): () => Promise<void> | void
  }
}

/** One route mounted by a plugin: POST, buffered body, JSON answer. */
export interface RouteHandler {
  /** Exact path on the `/api` channel. */
  readonly path: string
  /** Handler; must answer with `json()`. */
  readonly fetch: (request: Request) => Promise<Response>
}

/** JSON response helper; every route answers 200 (see the module docblock). */
export function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** Resolve the connection service without making it a hard dependency. */
function connectionOf(ctx: Context): ConnectionService | undefined {
  try {
    const resolved = ctx.get('connection') as ConnectionService | undefined
    const fallback = (ctx as unknown as { connection?: ConnectionService }).connection
    return resolved ?? fallback
  } catch {
    return undefined
  }
}

/**
 * Mount `POST` handlers once `ctx.connection` is available.
 *
 * @param ctx - context that owns the routes (disposed with it).
 * @param label - diagnostic prefix (the package name).
 * @param handlers - routes to register, in order.
 */
export function mountRoutes(ctx: Context, label: string, handlers: readonly RouteHandler[]): void {
  try {
    ctx.inject(['connection'], (scoped: Context) => {
      const connection = connectionOf(scoped)
      const register = connection?.fetch?.register
      if (typeof register !== 'function') {
        writeDiagnostic(`${label}: ctx.connection.fetch.register is unavailable; the UI cannot reach the Host`)
        return
      }
      for (const handler of handlers) {
        try {
          const dispose = register.call(connection?.fetch, {
            path: handler.path,
            methods: ['POST'],
            requestBody: 'buffered',
            fetch: async (request: Request) => {
              try {
                return await handler.fetch(request)
              } catch (error) {
                writeDiagnostic(`${label}: ${handler.path} failed: ${messageOf(error)}`)
                return json({ ok: false, reason: 'failed', error: messageOf(error) })
              }
            },
          })
          scoped.effect(() => () => { void dispose() }, `${label}: route ${handler.path}`)
          writeDiagnostic(`${label}: registered ${handler.path}`)
        } catch (error) {
          writeDiagnostic(`${label}: could not register ${handler.path}: ${messageOf(error)}`)
        }
      }
    })
  } catch (error) {
    writeDiagnostic(`${label}: could not wait for ctx.connection: ${messageOf(error)}`)
  }
}
