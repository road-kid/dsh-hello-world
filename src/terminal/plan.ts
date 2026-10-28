import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { messageOf } from '../diag.ts'
import type { TerminalFailure } from '../shared/protocol.ts'
import { bannerLines, type TerminalBanner } from './banner.ts'
import { shQuote, type Shim } from './shim.ts'

/**
 * One platform's launch plan.
 *
 * A plan is plain data â€?file, arguments, working directory, environment â€?so the
 * builders can be exercised without opening a window. The platforms differ only in
 * how a console is asked to appear: Windows goes through `cmd /c start` so the
 * window survives the Host, macOS hands a `.command` file to Terminal.app, and
 * Linux runs the first emulator it finds.
 *
 * This module is pure: it writes the welcome script a plan needs and returns the
 * plan, but never starts anything. `index.ts` owns the one side effect.
 */

/** One process to start, with its environment already resolved. */
export interface TerminalPlan {
  readonly file: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly hideWindow: false
  /** Environment for the terminal process; the launcher applies it verbatim. */
  readonly env?: NodeJS.ProcessEnv
}

/** A plan, or the reason there is none. */
export interface TerminalPlanResult {
  readonly ok: boolean
  readonly plan?: TerminalPlan
  readonly failure?: TerminalFailure
  readonly error?: string
  readonly tried?: readonly string[]
}

/** The terminal emulators tried on Linux, in preference order. */
export const LINUX_TERMINALS: readonly { readonly file: string; readonly args: readonly string[] }[] = [
  { file: 'x-terminal-emulator', args: ['-e'] },
  { file: 'gnome-terminal', args: ['--'] },
  { file: 'konsole', args: ['-e'] },
  { file: 'xfce4-terminal', args: ['-e'] },
  { file: 'xterm', args: ['-e'] },
]

/** PowerShell's absolute path: `PATH` is not consulted, so a stale entry cannot win. */
export function powershellPath(environment: NodeJS.ProcessEnv = process.env): string {
  const root = environment.SystemRoot ?? environment.windir ?? 'C:\\Windows'
  return join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

/** Quote one PowerShell single-quoted string. */
export function psQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * Whether `entry` resolves on the PATH of `environment`.
 *
 * This replaces two functions that disagreed: one split on the separator that
 * `process.platform` names and compared textually, the other split on both `;` and
 * `:` and checked the filesystem. A plan is built for a platform other than the
 * one running the tests, so the separator has to come from the string, and a
 * textual comparison cannot tell whether an emulator is installed at all.
 *
 * @param entry - file name or absolute path to look for.
 * @param environment - the environment whose PATH is searched.
 * @returns whether some PATH directory contains `entry`.
 */
export function isOnPath(entry: string, environment: NodeJS.ProcessEnv = process.env): boolean {
  const raw = environment.PATH ?? environment.Path ?? ''
  if (raw.length === 0) return false
  const directories = [...raw.split(';'), ...raw.split(':')].filter(directory => directory.length > 0)
  return directories.some(directory => existsSync(join(directory, entry)))
}

/**
 * Write one welcome script, turning a filesystem failure into the message a dialog
 * shows.
 *
 * @param file - where to write.
 * @param lines - the script body, already quoted.
 * @param newline - line separator for the target shell.
 * @param mode - file mode, for the POSIX scripts.
 * @returns the failure message, or `undefined` on success.
 */
function writeWelcome(file: string, lines: readonly string[], newline: string, mode?: number): string | undefined {
  try {
    const options = mode === undefined ? 'utf8' : { encoding: 'utf8' as const, mode }
    writeFileSync(file, `${lines.join(newline)}${newline}`, options)
    return undefined
  } catch (error) {
    return `could not write the terminal script: ${messageOf(error)}`
  }
}

/**
 * Build the Windows plan: a PowerShell welcome script started in a console the
 * Host does not own (it must outlive the Host).
 */
function windowsPlan(
  banner: TerminalBanner,
  environment: NodeJS.ProcessEnv,
  tmp: string,
  shim: Shim | undefined,
): TerminalPlanResult {
  // One stable path that every open overwrites, so opening the terminal a hundred
  // times leaves exactly one script behind.
  const script = join(shim?.root ?? tmp, 'welcome.ps1')
  const welcome = bannerLines(banner, 'win32')
  const lines = [
    `$Host.UI.RawUI.WindowTitle = ${psQuote(welcome[0] ?? banner.product ?? '')}`,
    'Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue',
  ]
  if (shim !== undefined) lines.push(`$env:PATH = ${psQuote(shim.directory)} + ';' + $env:PATH`)
  // The shell starts in the profile directory, not in the application directory the
  // banner prints: a packaged install sits under Program Files, and the shell's `dsh`
  // commands act on the profile wherever they run.
  lines.push(`Set-Location -LiteralPath ${psQuote(banner.profileDirectory)}`)
  for (const line of welcome) lines.push(`Write-Host ${psQuote(line)}`)
  const failed = writeWelcome(script, lines, '\r\n')
  if (failed !== undefined) return { ok: false, failure: 'script', error: failed }
  const powershell = powershellPath(environment)
  const comspec = environment.ComSpec ?? environment.COMSPEC ?? 'cmd.exe'
  return {
    ok: true,
    plan: {
      file: comspec,
      args: ['/d', '/c', 'start', '', powershell, '-NoLogo', '-NoExit', '-File', script],
      cwd: banner.profileDirectory,
      hideWindow: false,
      env: environment,
    },
  }
}

/** Build the macOS plan: a `.command` file executed by Terminal.app. */
function darwinPlan(
  banner: TerminalBanner,
  environment: NodeJS.ProcessEnv,
  tmp: string,
  shim: Shim | undefined,
): TerminalPlanResult {
  const script = join(shim?.root ?? tmp, 'welcome.command')
  const lines = ['#!/bin/bash', 'unset ELECTRON_RUN_AS_NODE', `cd ${shQuote(banner.profileDirectory)} || exit 1`, 'clear']
  for (const line of bannerLines(banner, 'darwin')) lines.push(`printf '%s\\n' ${shQuote(line)}`)
  lines.push('exec bash -l')
  const failed = writeWelcome(script, lines, '\n')
  if (failed !== undefined) return { ok: false, failure: 'script', error: failed }
  return {
    ok: true,
    plan: { file: '/usr/bin/open', args: ['-a', 'Terminal', script], cwd: banner.profileDirectory, hideWindow: false, env: environment },
  }
}

/**
 * Build the Linux plan: the first installed terminal emulator wins.
 *
 * @returns the plan, or `no-terminal` when none is installed.
 */
function linuxPlan(
  banner: TerminalBanner,
  environment: NodeJS.ProcessEnv,
  tmp: string,
  shim: Shim | undefined,
): TerminalPlanResult {
  const script = join(shim?.root ?? tmp, 'welcome.sh')
  const lines = ['#!/bin/sh', 'unset ELECTRON_RUN_AS_NODE', `cd ${shQuote(banner.profileDirectory)} || exit 1`]
  for (const line of bannerLines(banner, 'linux')) lines.push(`printf '%s\\n' ${shQuote(line)}`)
  lines.push('exec "${SHELL:-/bin/sh}" -l')
  const failed = writeWelcome(script, lines, '\n', 0o700)
  if (failed !== undefined) return { ok: false, failure: 'script', error: failed }
  const tried = LINUX_TERMINALS.map(entry => entry.file)
  for (const entry of LINUX_TERMINALS) {
    if (!isOnPath(entry.file, environment)) continue
    return {
      ok: true,
      plan: { file: entry.file, args: [...entry.args, script], cwd: banner.profileDirectory, hideWindow: false, env: environment },
    }
  }
  return { ok: false, failure: 'no-terminal', error: `no terminal program found (tried ${tried.join(', ')})`, tried }
}

/**
 * Build the launch plan for one platform.
 *
 * @param banner - reported values.
 * @param platform - target platform.
 * @param environment - environment for the child (the Host's, already adjusted).
 * @param tmp - temporary directory for the generated script.
 * @param shim - generated shim, when one was written.
 * @returns the plan or the failure.
 */
export function terminalPlan(
  banner: TerminalBanner,
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv = process.env,
  tmp: string = tmpdir(),
  shim?: Shim,
): TerminalPlanResult {
  if (platform === 'win32') return windowsPlan(banner, environment, tmp, shim)
  if (platform === 'darwin') return darwinPlan(banner, environment, tmp, shim)
  return linuxPlan(banner, environment, tmp, shim)
}
