import {
  isRestartResponse,
  isStatusResponse,
  ROUTE_RESTART,
  ROUTE_STATUS,
  ROUTE_TERMINAL,
  ROUTE_TERMINAL_STATUS,
  type RestartResponse,
  type StatusResponse,
  type TerminalResponse,
  type TerminalStatusResponse,
} from '../shared/protocol.ts'

/**
 * Client half of the routes.
 *
 * Every route answers HTTP 200 with `ok` in the body, so the only transport error
 * worth reporting is a network failure (the Host is going down — expected during
 * a desktop relaunch). Anything else becomes a generic message: the row must never
 * throw into React's render path.
 */

/** Raised for a transport failure; carries the reason the row shows. */
export class RestartRequestError extends Error {
  /**
   * The status the Host answered with, when the failure was an answer rather
   * than a transport fault. `undefined` means the request never got one.
   */
  readonly httpStatus: number | undefined

  /**
   * @param message - text that is safe to show to a person.
   * @param cause - the underlying failure, kept for diagnostics only.
   * @param httpStatus - status code when the Host answered and refused.
   */
  constructor(message: string, cause?: unknown, httpStatus?: number) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'RestartRequestError'
    this.httpStatus = httpStatus
  }
}

/** One POST against the plugin's API, parsed defensively. */
async function post(path: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      ...(signal === undefined ? {} : { signal }),
    })
  } catch (error) {
    throw new RestartRequestError(error instanceof Error ? error.message : String(error), error)
  }
  if (!response.ok) throw new RestartRequestError(`HTTP ${String(response.status)}`, undefined, response.status)
  try {
    return await response.json()
  } catch (error) {
    throw new RestartRequestError('the Host returned an unreadable answer', error)
  }
}

/**
 * Read the capability snapshot.
 *
 * @param signal - aborts the request.
 * @returns the status body, or `undefined` when the Host answered with a body
 *   this client cannot use. An older Host answers `{ ok: true }` with no
 *   capability; that is a definitive answer rather than a transport failure, so
 *   it is reported apart from a thrown error and the caller stops retrying.
 */
export async function fetchStatus(signal?: AbortSignal): Promise<StatusResponse | undefined> {
  const body = await post(ROUTE_STATUS, signal)
  return isStatusResponse(body) ? body : undefined
}

/** Ask the Host to restart; the response arrives before the process leaves. */
export async function requestRestart(signal?: AbortSignal): Promise<RestartResponse> {
  const body = await post(ROUTE_RESTART, signal)
  if (!isRestartResponse(body)) throw new RestartRequestError('unexpected restart payload')
  return body
}

/** Ask the Host to open a terminal at the profile directory. */
export async function openTerminal(signal?: AbortSignal): Promise<TerminalResponse> {
  const body = await post(ROUTE_TERMINAL, signal)
  if (typeof body !== 'object' || body === null || typeof (body as { ok?: unknown }).ok !== 'boolean') {
    throw new RestartRequestError('unexpected terminal payload')
  }
  return body as TerminalResponse
}

/**
 * What a probe of the terminal component told us.
 *
 * - `available`: the component is mounted and can open a terminal;
 * - `unavailable`: the Host answered, and the answer is that the component is
 *   not mounted — the route it owns is gone. A definitive no;
 * - `unknown`: the Host did not answer at all (it is restarting, the connection
 *   dropped, it answered with an error). Not an answer *about* the component, so
 *   nothing may be hidden because of it.
 */
export type TerminalAvailability = 'available' | 'unavailable' | 'unknown'

/**
 * Ask whether the terminal component is mounted.
 *
 * The settings action lives in the terminal package's own bundle, and the page
 * loader unloads that bundle when the component is switched off — so the action
 * normally never renders in that state. This probe only covers the window before
 * that unload lands, which is why it must never reject: the caller paints the
 * action first and hides it afterwards, and a transport failure has to read as
 * "no answer" rather than "gone".
 *
 * @param signal - aborts the request.
 * @returns the tri-state answer described on {@link TerminalAvailability}.
 */
export async function fetchTerminalStatus(signal?: AbortSignal): Promise<TerminalAvailability> {
  try {
    const body = await post(ROUTE_TERMINAL_STATUS, signal)
    if (typeof body !== 'object' || body === null) return 'unavailable'
    const candidate = body as Partial<TerminalStatusResponse>
    return candidate.ok === true && candidate.available === true ? 'available' : 'unavailable'
  } catch (error) {
    // A 404 is the Host saying this route is not mounted, i.e. the component is
    // off. Anything else — a refused connection, a 500 — is the Host not
    // answering, and hiding a button on that would make it blink on every
    // restart.
    return error instanceof RestartRequestError && error.httpStatus === 404 ? 'unavailable' : 'unknown'
  }
}
