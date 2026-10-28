/**
 * Watchdog plan (plain data).
 *
 * The Host never restarts itself: it hands this plan to a *detached* helper
 * process, which outlives the Host and is therefore able to wait for it to
 * disappear, wait for the listening port to be released, and start the
 * replacement. Both sides import this file, so the wire shape lives in one
 * place and the helper half stays a pure consumer of data.
 */

/** Bumped when the shape changes incompatibly; the helper refuses other values. */
export const HELPER_PLAN_VERSION = 1

/** One executable plus its arguments, replayable exactly. */
export interface LaunchSpec {
  /** Absolute executable path. */
  readonly file: string
  readonly args: readonly string[]
  /** Working directory the replacement must inherit. */
  readonly cwd?: string
  /**
   * Whether `file` is a shell shim (`.cmd` / `.bat`) that cannot be spawned
   * directly on Windows. Only then does the helper route through PowerShell.
   */
  readonly viaShell?: boolean
  /**
   * Environment variables to remove from the replacement.
   *
   * The desktop application is started from a Host that runs in Electron node
   * mode, so `ELECTRON_RUN_AS_NODE` must be dropped or the executable would wait
   * for a script and exit immediately.
   */
  readonly unsetEnv?: readonly string[]
  /**
   * Whether Windows may hide the replacement's first window.
   *
   * Defaults to true (a console spawn shows no black window). The desktop
   * relaunch must pass `false`: `windowsHide` is `STARTF_USESHOWWINDOW`/`SW_HIDE`,
   * which the Electron application inherits for its first `BrowserWindow`, and
   * the app then comes up as a tray icon with no window.
   */
  readonly hideWindow?: boolean
}

/** Everything the helper needs; written to a JSON file next to the log. */
export interface HelperPlan {
  readonly version: number
  /** `desktop` restarts the whole application, `cli` replays one command line. */
  readonly target: 'cli' | 'desktop'
  /** The Host that must disappear before the replacement starts. */
  readonly hostPid: number
  /** The desktop shell that owns the Host; killed first on `desktop`. */
  readonly shellPid?: number
  /** Loopback address the replacement is expected to bind (`127.0.0.1`). */
  readonly host?: string
  /** Listening port to wait for and verify; absent when the Host has no web server. */
  readonly port?: number
  /** What to start. */
  readonly launch: LaunchSpec
  /** Shared diagnostic file (the Host and the helper append to the same file). */
  readonly logFile: string
  /** How long to wait before tearing the old process down. */
  readonly startDelayMs: number
  /** How long to wait for old processes / the port before forcing the issue. */
  readonly waitTimeoutMs: number
  /** How long the replacement has to prove it came up. */
  readonly settleTimeoutMs: number
  /** `process.platform` of the Host, used for the spawn strategy. */
  readonly platform: string
}
