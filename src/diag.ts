import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

/**
 * Diagnostic log.
 *
 * The restart path can fail in ways that are invisible from the UI (a helper
 * that never launched, a port that never freed, a shell that refused to die), so
 * every stage is appended to one file. Nothing here may throw: a diagnostic
 * write must never be the reason a restart fails.
 *
 * The file is capped at {@link MAX_LOG_BYTES}. Past that budget the previous
 * content is moved aside to `.1` before the next line is written, so the live
 * file always describes the most recent failure and one generation keeps the
 * run-up to it. A support log that grows for as long as the Host runs is a bug:
 * the plugin polls the status route every few seconds, so an uncapped file is
 * unbounded by construction.
 */

/** Size at which the log is rotated; the README promises 512 KiB. */
const MAX_LOG_BYTES = 512 * 1024

/** One generation is kept: enough to see what led up to the last failure. */
const ARCHIVE_SUFFIX = '.1'

/**
 * Path of the diagnostic log.
 *
 * `DSH_HELLO_WORLD_LOG` overrides the location (tests point it at a sandbox). The
 * older `DSH_JUST_RESTART_LOG` is still honoured as a fallback: it is the name the
 * project used before the plugin was renamed to `dsh-hello-world`, and a script or
 * shell profile that still exports it must keep pointing at the same file instead
 * of silently logging somewhere else.
 *
 * @returns the log path; the directory may not exist yet.
 */
export function logFile(): string {
  const override = process.env.DSH_HELLO_WORLD_LOG
  if (override !== undefined && override !== '') return override
  const legacy = process.env.DSH_JUST_RESTART_LOG
  if (legacy !== undefined && legacy !== '') return legacy
  return join(tmpdir(), 'dsh-hello-world.log')
}

/**
 * Move the current log aside once it has reached its budget.
 *
 * The size is read with one `stat` before each append. Caching it would make the
 * cap depend on write order for no gain: the log is written a handful of times a
 * minute, and a syscall is cheaper than a size counter that can drift.
 *
 * `rename` replaces an existing archive in one step (POSIX `rename`, Windows
 * `MoveFileEx`), but on Windows a reader still holding the old file open turns
 * that into `EPERM`, so the retry removes the archive first. Both attempts stay
 * inside the caller's guard: a rotating log can never break the caller.
 */
function rotate(file: string): void {
  const size = statSync(file, { throwIfNoEntry: false })?.size ?? 0
  if (size < MAX_LOG_BYTES) return
  const archive = `${file}${ARCHIVE_SUFFIX}`
  try {
    renameSync(file, archive)
  } catch {
    rmSync(archive, { force: true })
    renameSync(file, archive)
  }
}

/** Append one timestamped line; never throws. */
export function writeDiagnostic(message: string): void {
  try {
    const file = logFile()
    mkdirSync(dirname(file), { recursive: true })
    rotate(file)
    appendFileSync(file, `[${new Date().toISOString()}] [${basename(process.execPath)}:${process.pid}] ${message}\n`)
  } catch {
    // A diagnostic failure is not an application failure.
  }
}

/** `err instanceof Error ? err.message : String(err)`. */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
