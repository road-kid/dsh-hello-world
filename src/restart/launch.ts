import { existsSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

import type { LaunchSpec } from '../shared/helper-plan.ts'

/**
 * How to start the replacement.
 *
 * There are exactly two situations, and they need opposite strategies:
 *
 * - **Command line** (`dsh web …`, including a source checkout): the Host owns
 *   its own command line, so the restart replays it. A global `dsh` install has
 *   `argv[1]` pointing at `lib/bin.js`, which is replayed through the current
 *   Node executable; anything else falls back to the `dsh` launcher itself.
 *   The replay is adjusted in two ways so the page survives it: a `--port 0`
 *   request keeps the port this Host actually bound, and a web invocation gets
 *   `--no-open` so the replacement does not open a second browser tab.
 * - **Desktop** (the official Electron application): the Host is a child of the
 *   shell, so the *application* is started again. In a packaged build the Host
 *   runs under the application executable in Electron node mode
 *   (`ELECTRON_RUN_AS_NODE=1`), which is why the same path can start the app
 *   once that variable is removed.
 */

/** Entry points that mean "this is the dsh launcher, replay it through node". */
const LAUNCHER_ENTRY = /[\\/](?:bin\.(?:js|ts)|dsh)$/u

/** `node` executable to use: prefer the absolute `argv0`, else the running one. */
export function nodeExecutable(
  argv0: string = process.argv0,
  execPath: string = process.execPath,
): string {
  if (argv0.length > 0 && existsSync(argv0)) return argv0
  return execPath
}

/** Whether this process is the official desktop Host (Electron node mode + the desktop host entry). */
export function isOfficialDesktopHost(
  environment: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
): boolean {
  if (environment.ELECTRON_RUN_AS_NODE !== '1') return false
  // The shell starts `<app>/…/@deepseek-ai/dsh-desktop-host/lib/index.js`; the
  // entry name is stable across releases whereas the surrounding layout is not.
  return argv.some(argument => argument.includes('dsh-desktop-host'))
}

/** Replay the current command line. */
export function cliLaunch(
  argv: readonly string[] = process.argv,
  execArgv: readonly string[] = process.execArgv,
  platform: string = process.platform,
  execPath: string = process.execPath,
  boundPort: number | undefined = undefined,
): LaunchSpec {
  const entry = argv[1] ?? ''
  const args = replayArgs(argv.slice(2), boundPort)
  if (LAUNCHER_ENTRY.test(entry)) {
    const absolute = resolve(entry)
    return {
      file: nodeExecutable(process.argv0, execPath),
      // `execArgv` carries the loader/experimental flags the launcher was started with.
      args: [...execArgv, absolute, ...args],
      cwd: dirname(absolute),
    }
  }
  // Unknown entry point: let the launcher resolve its own profile again.
  if (platform === 'win32') {
    // `dsh.cmd`, never `dsh.ps1` (an ExecutionPolicy may refuse the script).
    return { file: 'dsh.cmd', args, cwd: process.cwd(), viaShell: true }
  }
  return { file: 'dsh', args, cwd: process.cwd() }
}

/**
 * Adjust the arguments of a command-line replay.
 *
 * `--port 0` asks the operating system for a free port, so replaying it verbatim
 * would move the replacement to a different port: the page that asked for the
 * restart would point at an origin that no longer answers, and the watchdog would
 * wait for a port nobody is going to bind. The replacement keeps the port this
 * Host is listening on instead.
 *
 * A web Host opens the default browser on startup, and the restart already has a
 * page open, so the replay adds `--no-open`. On Windows that browser launch goes
 * through PowerShell, which is the extra window a restart from a terminal used to
 * flash.
 */
function replayArgs(args: readonly string[], boundPort: number | undefined): string[] {
  const replay = [...args]
  if (boundPort !== undefined) {
    for (let index = 0; index < replay.length; index += 1) {
      const argument = replay[index]!
      if (argument === '--port' && replay[index + 1] === '0') {
        replay[index + 1] = String(boundPort)
        index += 1
      } else if (argument === '--port=0') {
        replay[index] = `--port=${String(boundPort)}`
      }
    }
  }
  if (isWebInvocation(replay) && !replay.includes('--no-open')) replay.push('--no-open')
  return replay
}

/** Whether the replayed arguments select the web profile (`dsh web`, `dsh --profile web`). */
function isWebInvocation(args: readonly string[]): boolean {
  const command = args.find(argument => !argument.startsWith('-'))
  if (command === 'web') return true
  return args.some(
    (argument, index) => argument === '--profile=web' || (argument === '--profile' && args[index + 1] === 'web'),
  )
}

/**
 * Start the desktop application again, outside Electron node mode.
 *
 * Two Windows details matter, both learned the hard way:
 *
 * - `--updated` is the flag the NSIS installer passes when it launches the
 *   application after an update; the shell reacts by raising and focusing the
 *   window it creates (`apps/desktop/src/main.ts`: `raiseAfterUpdate`). Without
 *   it the relaunched app can sit behind the browser the user was looking at.
 * - `hideWindow: false` keeps the spawn from inheriting a hidden show state, so
 *   the application actually comes up instead of starting tray-only.
 */
export function desktopLaunch(
  execPath: string = process.execPath,
  platform: string = process.platform,
): LaunchSpec {
  return {
    file: execPath,
    args: platform === 'win32' ? ['--updated'] : [],
    cwd: dirname(execPath),
    // Without this the executable would run as Node with no script and exit at once.
    unsetEnv: ['ELECTRON_RUN_AS_NODE'],
    hideWindow: false,
  }
}

/** Human-readable form of a launch spec, for the log and the status detail. */
export function describeLaunch(spec: LaunchSpec): string {
  const file = basename(spec.file)
  return [file, ...spec.args].join(' ')
}
