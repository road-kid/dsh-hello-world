/**
 * Host / client wire protocol (plain data: no node, no DOM, no React).
 *
 * Both halves of the plugin import this file, so it is the single source of
 * truth for route paths, capability shape and lifecycle words. Nothing here may
 * import a runtime module: the client bundle and the host bundle share only
 * these declarations.
 *
 * Transport: exact Fetch routes on the authenticated `/api` channel
 * (`ctx.connection.fetch.register`). Only the owner peer (this page, carrying
 * the session cookie) reaches them; every other principal gets 403 from the
 * shared channel handler. The host half additionally re-checks the request
 * origin as defence in depth, because a route that kills a process or starts a
 * shell must never be callable from a forwarded or rebound request.
 *
 * Both routes always answer HTTP 200 with `ok` in the body: the client renders
 * the reason, and a 4xx would surface only as a bare `HTTP <status>`.
 */

/** Package name of the bundle this plugin installs; also the profile patch id. */
export const PLUGIN_NAME = 'dsh-hello-world'

/** Package name of the restart component; also its client bundle id. */
export const RESTART_PLUGIN_NAME = 'dsh-quick-restart'

/**
 * Package name of the terminal component.
 *
 * The terminal ships as its own package so the plugin manager can give the two
 * components their own title and description: a bundle row takes its copy from
 * the meta of the package it names, and one package can only carry one meta.
 */
export const TERMINAL_PLUGIN_NAME = 'dsh-quick-terminal'

/**
 * Kept in step with `package.json` by hand, and checked by
 * `scripts/verify-bundle.mjs`, which compares it against all three manifests.
 */
export const PLUGIN_VERSION = '0.1.0'

/**
 * `activeTasks` sentinel: the work services were unavailable, so the count is
 * unknown. A number rather than `null` because the value crosses JSON and the
 * client compares it arithmetically.
 */
export const UNKNOWN_ACTIVE_TASKS = -1

/** Capability + live state. Cheap: never spawns a process and never writes the log. */
export const ROUTE_STATUS = '/api/dsh-hello-world/status'

/** Schedule a restart. Answers before the process goes down. */
export const ROUTE_RESTART = '/api/dsh-hello-world/restart'

/** Open a terminal at the profile directory. Starts a new window; stops nothing. */
export const ROUTE_TERMINAL = '/api/dsh-hello-world/terminal/open'

/**
 * Whether the terminal component is mounted.
 *
 * Registered by the terminal package only, so the client bundle can tell "the
 * route answered" from "the route is gone" during the short window in which the
 * plugin manager has switched the component off but the page still runs the
 * bundle it loaded earlier.
 */
export const ROUTE_TERMINAL_STATUS = '/api/dsh-hello-world/terminal/status'

/**
 * How a restart is carried out.
 *
 * - `desktop`: the Host is a child of the official desktop shell (Electron), so
 *   the *whole application* is relaunched: a detached watchdog waits for the
 *   shell and this Host to exit, then starts the application again.
 * - `cli`: this Host owns its own command line (`dsh web …`), so the watchdog
 *   waits for the listening port to be released and replays that command line.
 */
export type RestartTarget = 'desktop' | 'cli'

/** `idle` → `scheduled` (watchdog armed) → `restarting` (this process is leaving). */
export type RestartState = 'idle' | 'scheduled' | 'restarting'

/**
 * Who would perform the restart.
 *
 * Reported for diagnostics and for the row's tooltip: `dsh-hello-world` means this
 * plugin's watchdog replays a command line, `desktop-shell` means it relaunches
 * the application that owns the Host, `operator` means a human should do it.
 */
export type ManagedBy = 'dsh-hello-world' | 'desktop-shell' | 'operator'

/** Machine-readable reason a restart is refused; the client localizes it. */
export type RestartRefusal =
  | 'supervisor'
  | 'debugger'
  | 'disabled'
  | 'busy'
  | 'host'

/**
 * Why a restart request did not produce a plan.
 *
 * `failed` is the catch-all for a thrown error: unlike the refusal reasons it
 * carries no user-actionable meaning, only an error message.
 */
export type RestartFailure = RestartRefusal | 'failed'

/**
 * The `profileContext` service as this plugin uses it.
 *
 * Declared here instead of imported from the host package so both halves and
 * the terminal package agree on one shape. `dir` is optional because older
 * hosts only expose `name`.
 */
export interface ProfileContextView {
  name?: string
  dir?: string
}

/** Capability snapshot handed to the row on every mount. */
export interface RestartCapability {
  /** Whether a restart can be requested right now. */
  supported: boolean
  target: RestartTarget
  managedBy: ManagedBy
  /** Set only when `supported` is false. */
  reason?: RestartRefusal
  /** Supervisor name (`systemd`, `launchd`, `pm2`, `supervisord`) when detected. */
  supervisor: string | null
  /** Debugger kind (`inspector`) when detected. */
  debugger: string | null
  /** `process.platform` of the Host. */
  platform: string
  /** Host pid; shown in the confirm dialog so a user can match it to a process list. */
  pid: number
  /** Desktop shell pid when `target` is `desktop`. */
  shellPid?: number
  /**
   * Work this restart would interrupt (running agents, queued turns, jobs).
   * `UNKNOWN_ACTIVE_TASKS` means the work services are unavailable.
   */
  activeTasks: number
  state: RestartState
  /** Whether the confirm dialog is required before requesting a restart. */
  confirmBeforeRestart: boolean
  /** Whether active work refuses the restart (mirrors the Host config). */
  refuseWhileBusy: boolean
  /** Plugin version, for the diagnostic line. */
  version: string
  /** What a restart would do here (which application is relaunched, which line replayed). */
  detail?: string
  /** The exact command line the next Host will run, shown in the confirm dialog. */
  command?: string
  /** Diagnostic log every restart stage is appended to. */
  logFile?: string
}

/** `POST /api/dsh-hello-world/status` response. */
export interface StatusResponse {
  ok: true
  capability: RestartCapability
}

/** What the watchdog is about to do; returned so the UI can word the toast. */
export interface RestartPlanView {
  target: RestartTarget
  pid: number
  helperPid?: number
  /** Command line replayed for `target: 'cli'`. */
  command?: string
  /** Human-readable summary of the processes / ports waited on. */
  waits?: string[]
  logFile?: string
}

/** `POST /api/dsh-hello-world/restart` response. */
export interface RestartResponse {
  ok: boolean
  reason?: RestartFailure
  error?: string
  plan?: RestartPlanView
  capability?: RestartCapability
}

/**
 * Why a terminal could not be started.
 *
 * - `no-terminal`: no terminal program this deployment knows how to start on PATH;
 * - `script`: the launcher script could not be written;
 * - `launch`: the launcher exists but starting it failed.
 *
 * The client words each case itself, so the reason survives translation.
 */
export type TerminalFailure = 'no-terminal' | 'script' | 'launch'

/**
 * `POST /api/dsh-hello-world/terminal/status` response.
 *
 * Registered by the terminal package only, so a missing route means the
 * component is switched off. `available` is always true when the route answers:
 * the route existing *is* the answer, and the field is kept so the body stays a
 * plain success envelope like every other route here.
 */
export interface TerminalStatusResponse {
  ok: boolean
  available?: boolean
  platform?: string
  error?: string
}

/** `POST /api/dsh-hello-world/terminal/open` response. */
export interface TerminalResponse {
  ok: boolean
  error?: string
  failure?: TerminalFailure
  /** Launchers tried, in order, when none of them was found. */
  tried?: readonly string[]
  /** Directory the terminal opened in. */
  directory?: string
}

/** Type guard for a JSON body of the restart route (defensive parsing on the client). */
export function isRestartResponse(value: unknown): value is RestartResponse {
  return typeof value === 'object' && value !== null && typeof (value as { ok?: unknown }).ok === 'boolean'
}

/**
 * Type guard for the status body.
 *
 * Checks the one field the client dereferences (`capability.supported`) instead
 * of trusting the cast: a Host from an older version answers `{ ok: true }` with
 * no capability, and the row must then render as unavailable rather than crash.
 */
export function isStatusResponse(value: unknown): value is StatusResponse {
  if (typeof value !== 'object' || value === null) return false
  const body = value as { ok?: unknown; capability?: unknown }
  if (body.ok !== true) return false
  if (typeof body.capability !== 'object' || body.capability === null) return false
  return typeof (body.capability as { supported?: unknown }).supported === 'boolean'
}
