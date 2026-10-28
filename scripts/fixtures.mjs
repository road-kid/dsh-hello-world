/**
 * Fixtures shared by the verification scripts.
 *
 * The scripts deliberately differ in one place — whether active work refuses a
 * restart — so the base config lives here and every script states its own
 * override next to the reason for it. Two same-named `const config` objects with
 * silently different values is exactly how a fixture drifts away from what the
 * other script believes it is proving.
 */
import { readFileSync } from 'node:fs'

/**
 * Host config with the same values as the defaults in `src/config.ts`.
 * Frozen: a script that wants different values goes through `configWith`.
 */
export const BASE_CONFIG = Object.freeze({
  enabled: true,
  confirmBeforeRestart: true,
  refuseWhileBusy: false,
  allowSupervisor: false,
  delayMs: 250,
  waitTimeoutMs: 30_000,
  settleTimeoutMs: 30_000,
})

/**
 * A config snapshot with explicit overrides.
 * @param {Partial<typeof BASE_CONFIG>} [overrides] - fields to replace.
 * @returns {typeof BASE_CONFIG} the merged snapshot.
 */
export function configWith(overrides = {}) {
  return { ...BASE_CONFIG, ...overrides }
}

/**
 * Number of non-empty lines in a diagnostic log, or 0 when it does not exist.
 * @param {string} file - absolute log path.
 * @returns {number} line count.
 */
export function logLineCount(file) {
  try {
    return readFileSync(file, 'utf8').split('\n').filter(line => line.length > 0).length
  } catch {
    return 0
  }
}
