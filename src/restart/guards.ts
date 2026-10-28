import { readFileSync } from 'node:fs'
import { url as inspectorUrl } from 'node:inspector'

/**
 * Reasons a restart may be unsafe, detected without spawning anything.
 *
 * A restart replaces the process that is serving this page. That is only sane
 * when this process is the thing an operator expects to own its life: not when a
 * supervisor owns it (systemd with `KillMode=control-group` kills the detached
 * helper together with the Host, and `Restart=on-failure` fights a manual
 * relaunch), and not while a debugger is attached (the inspector session would
 * be lost and the next breakpoint would never be hit).
 *
 * Every probe here is read-only and cheap enough for a capability request. Any
 * uncertainty resolves to "not detected", because a false refusal hides a
 * feature; the corresponding *positive* refusal is stated in the UI with the
 * detected mechanism, so a wrong answer is at least visible.
 */

/** Timeout for the parent-process probe; a slow call must not stall the row. */
const PROBE_TIMEOUT_MS = 1_500

/** Read `/proc/<pid>/comm`; returns `undefined` on any other platform or failure. */
function readParentComm(ppid: number): string | undefined {
  try {
    return readFileSync(`/proc/${String(ppid)}/comm`, 'utf8').trim()
  } catch {
    return undefined
  }
}

/**
 * Detect the process supervisor that owns this process, if any.
 *
 * The env markers are the only reliable signal: on systemd, `INVOCATION_ID` is
 * set for every service unit, and `JOURNAL_STREAM` when the unit logs to the
 * journal. Requiring one of them prevents a stray `parent pid 1` (a container
 * init, a terminal multiplexer) from being mistaken for systemd.
 *
 * @param environment - environment to inspect (defaults to `process.env`).
 * @param ppid - parent pid (defaults to `process.ppid`).
 * @param comm - parent command-name probe, injectable for tests.
 * @returns the supervisor name, or `null`.
 */
export function detectedSupervisor(
  environment: NodeJS.ProcessEnv = process.env,
  ppid: number = process.ppid,
  comm: (ppid: number) => string | undefined = readParentComm,
): string | null {
  if (environment.SUPERVISOR_ENABLED === '1' || environment.SUPERVISOR_PROCESS_NAME !== undefined) {
    return 'supervisord'
  }
  if (environment.PM2_HOME !== undefined || environment.pm_id !== undefined) return 'pm2'
  if (process.platform === 'darwin' && environment.XPC_SERVICE_NAME !== undefined && environment.XPC_SERVICE_NAME !== '') {
    return 'launchd'
  }
  const systemdMarked = environment.INVOCATION_ID !== undefined || environment.JOURNAL_STREAM !== undefined
  if (systemdMarked) {
    if (ppid <= 1) return 'systemd'
    if (comm(ppid) === 'systemd') return 'systemd'
  }
  return null
}

/**
 * Detect an attached debugger.
 *
 * `inspector.url()` is the authoritative signal for this process; the exec-argv
 * and `NODE_OPTIONS` scans catch a session that was opened later (an inspector
 * URL is only observable once a session exists) and a flag inherited by the
 * replacement.
 *
 * @param inspectorUrl - `inspector.url()` of the Host (injectable for tests).
 * @param execArgv - `process.execArgv` (injectable for tests).
 * @param nodeOptions - `NODE_OPTIONS` (injectable for tests).
 * @returns `'inspector'`, or `null`.
 */
export function detectedDebugger(
  inspectorUrl: string | undefined = currentInspectorUrl(),
  execArgv: readonly string[] = process.execArgv,
  nodeOptions: string = process.env.NODE_OPTIONS ?? '',
): string | null {
  if (inspectorUrl !== undefined && inspectorUrl !== '') return 'inspector'
  const tokens = [...execArgv, ...nodeOptions.split(/\s+/u)]
  for (const token of tokens) {
    if (/^--(?:inspect|inspect-brk|inspect-port|inspect-wait|debug|debug-brk)(?:=|$)/u.test(token)) return 'inspector'
  }
  return null
}

/**
 * Defence-in-depth check for a restart request.
 *
 * The route is already mounted on the authenticated `/api` channel, so only the
 * page's owner peer can reach it. This check exists because the route kills a
 * process:
 *
 * - a request that carries forwarding headers did not come from the page itself;
 * - a cross-site fetch is never a legitimate restart;
 * - the `Host` authority must be loopback (DNS rebinding defence: a rebound
 *   name would otherwise reach this route with a matching `Origin`/`Host` pair);
 * - a present `Origin` must agree with `Host`.
 *
 * An *absent* `Origin` is accepted: the official desktop shell proxies page
 * requests into the Host and strips `Origin` on purpose, so requiring it would
 * break exactly the deployment this plugin is meant to support.
 *
 * @param request - the incoming `Request`.
 * @returns whether the request may restart this process.
 */
export function trustedLocalRequest(request: Request): boolean {
  const headers = request.headers
  for (const name of ['forwarded', 'x-forwarded-for', 'x-real-ip', 'x-forwarded-host']) {
    if (headers.get(name) !== null) return false
  }
  if (headers.get('sec-fetch-site') === 'cross-site') return false
  const origin = headers.get('origin')
  const host = headers.get('host')
  if (host === null || host === '' || !loopbackAuthority(host)) return false
  if (origin !== null && origin !== '') {
    let originHost: string
    try {
      const url = new URL(origin)
      // `dsh-app:` is the desktop shell's page origin; it is a trusted local page.
      if (url.protocol === 'dsh-app:') return true
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
      originHost = url.host
    } catch {
      return false
    }
    return originHost === host
  }
  return true
}

/** Whether `host[:port]` names this machine (or a name that can only mean it). */
function loopbackAuthority(authority: string): boolean {
  const name = authority.startsWith('[')
    ? authority.slice(0, authority.indexOf(']') + 1).toLowerCase()
    : (authority.split(':')[0] ?? '').toLowerCase()
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]' || name === '::1'
}

/** `inspector.url()` wrapped so a build without the module cannot crash the probe. */
function currentInspectorUrl(): string | undefined {
  try {
    return inspectorUrl()
  } catch {
    return undefined
  }
}

/** Abort a probe once it takes unreasonably long; probe failures resolve `undefined`. */
export async function withTimeout<T>(work: Promise<T>, milliseconds: number = PROBE_TIMEOUT_MS): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => { resolve(undefined) }, milliseconds)
    timer.unref()
  })
  try {
    return await Promise.race([work, timeout])
  } catch {
    return undefined
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
