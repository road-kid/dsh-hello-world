/**
 * One capability snapshot and one restart-unconfirmed flag, shared by every surface.
 *
 * The restart action reads the capability from one route; a surface mounted after
 * a restart started has to read the same flag. Every surface therefore subscribes
 * here instead of fetching on its own, which also keeps a single request per page
 * load.
 *
 * `useSyncExternalStore` requires `getSnapshot` to return a stable reference, so
 * every snapshot below is frozen and replaced only when the value really changes.
 */

import type { RestartCapability } from '../shared/protocol.ts'
import { fetchStatus } from './api.ts'

/** Whether the Host has answered yet. */
export type RestartStatus = 'loading' | 'ready' | 'unavailable'

export interface RestartSnapshot {
  readonly status: RestartStatus
  readonly capability?: RestartCapability
}

const LOADING: RestartSnapshot = Object.freeze({ status: 'loading' })
const UNAVAILABLE: RestartSnapshot = Object.freeze({ status: 'unavailable' })

let snapshot: RestartSnapshot = LOADING
const snapshotListeners = new Set<() => void>()

/** Current snapshot; stable between changes. */
export function restartSnapshot(): RestartSnapshot {
  return snapshot
}

/** Subscribe to capability changes. */
export function subscribeRestart(listener: () => void): () => void {
  snapshotListeners.add(listener)
  return () => { snapshotListeners.delete(listener) }
}

/**
 * Every field a surface can render, compared one by one.
 *
 * `useSyncExternalStore` re-renders on a new snapshot reference, so publishing an
 * equal value would repaint the whole tree — and restart the banner's hold timer
 * through its `[holdMs, onDone]` effect — on every background poll. `RestartCapability`
 * is flat data, so a field list is enough. Keep it in step with the protocol: a
 * renamed field fails to compile here, a new one has to be added by hand.
 */
const COMPARED_FIELDS = [
  'supported',
  'target',
  'managedBy',
  'reason',
  'supervisor',
  'debugger',
  'platform',
  'pid',
  'shellPid',
  'activeTasks',
  'state',
  'confirmBeforeRestart',
  'refuseWhileBusy',
  'version',
  'detail',
  'command',
  'logFile',
] as const satisfies readonly (keyof RestartCapability)[]

/**
 * Whether two capabilities would render identically.
 *
 * @param a - stored capability.
 * @param b - candidate replacement.
 * @returns `true` when every compared field is equal.
 */
function sameCapability(a: RestartCapability, b: RestartCapability): boolean {
  return COMPARED_FIELDS.every(field => a[field] === b[field])
}

/** Replace the capability (a route answer, or a refreshed one after a failure). */
export function setRestartCapability(capability: RestartCapability): void {
  if (snapshot.capability !== undefined && sameCapability(snapshot.capability, capability)) return
  snapshot = Object.freeze({ status: 'ready', capability })
  for (const listener of [...snapshotListeners]) listener()
}

function markUnavailable(): void {
  if (snapshot === UNAVAILABLE) return
  snapshot = UNAVAILABLE
  for (const listener of [...snapshotListeners]) listener()
}

/**
 * How many times the status route is tried before the host half is assumed absent.
 *
 * The client entry is `immediately`, so it can run in the same tick the page
 * boots, before the first fetch is accepted; two quick retries cover that window
 * without leaving a dead row behind for the rest of the session.
 */
const ATTEMPTS = 3
const RETRY_DELAY_MS = 500

let pendingLoad: Promise<void> | undefined

/**
 * Read the capability once and store it.
 *
 * @param signal - aborts the request.
 * @returns whether the Host answered.
 */
export async function refreshRestart(signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetchStatus(signal)
    if (response === undefined) {
      // The Host answered without a capability this client can read. Retrying
      // cannot change the answer, so it counts as a successful read that leaves
      // the row unavailable instead of burning the retry budget.
      markUnavailable()
      return true
    }
    setRestartCapability(response.capability)
    return true
  } catch {
    return false
  }
}

/**
 * Load the capability once, retrying a couple of times.
 *
 * The settled promise is forgotten, so a surface that mounts after the plugin was
 * switched off and on again re-reads the capability instead of awaiting a result
 * that will never change. The background watch belongs to the caller's effect
 * (`watchRestart`), not here: this promise has no lifetime to hang it on.
 *
 * @returns a promise that settles when a snapshot (ready or unavailable) exists.
 */
export function loadRestart(): Promise<void> {
  if (pendingLoad !== undefined) return pendingLoad
  const load = (async (): Promise<void> => {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      if (await refreshRestart()) return
      if (attempt === ATTEMPTS) {
        markUnavailable()
        return
      }
      await new Promise<void>((resolve) => { setTimeout(resolve, RETRY_DELAY_MS) })
    }
  })()
  pendingLoad = load
  // Clear only this promise: a later load may already have replaced it, and a
  // blanket clear would let a second load run beside the one in flight.
  const settle = (): void => { if (pendingLoad === load) pendingLoad = undefined }
  void load.then(settle, settle)
  return load
}

/**
 * How often the status route is re-read while the page lives.
 *
 * The plugin manager can switch the restart component off (and back on) without
 * reloading the page: the component's routes then disappear from the Host, but
 * this page keeps the capability it read at boot and would keep showing a row
 * that can no longer act. A cheap local read notices both directions.
 */
export const WATCH_POLL_MS = 5000

/** Consecutive background failures before a `ready` capability is retracted. */
const WATCH_FAILURES = 2

/**
 * Node's interval handle can be detached from the event loop; a browser's
 * numeric handle has no such method. Declared here so the optional call needs no
 * cast at the call site.
 */
interface UnrefTimer {
  unref?: () => void
}

let watchTimer: ReturnType<typeof setInterval> | undefined
let watchFailures = 0
let watchOwners = 0

/** Re-read immediately when the page becomes visible again. */
function onVisibilityChange(): void {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
  watchFailures = 0
  void refreshRestart()
}

/**
 * Keep the snapshot honest for the lifetime of the page.
 *
 * Reads are skipped while the tab is hidden and while a restart is unconfirmed
 * (the recovery loop in `awaitRestartedHost` is already polling then). Two
 * consecutive failures retract a stale `ready`, so a switched-off component
 * takes its row with it instead of leaving a dead button behind.
 *
 * The disposer is what makes the watch survive a component switch: the plugin
 * manager can unload this bundle without reloading the page, and an interval
 * that outlived it would keep posting to a route that no longer exists while
 * pinning the document's listener for the rest of the session.
 *
 * Owners are counted rather than tracked one at a time: `apply` can run again
 * while a previous run is still tearing down, and a second caller that silently
 * got no interval of its own would lose the watch as soon as the first one
 * released it. Only the last release stops the interval, and only the first call
 * starts it, so the poll rate never doubles.
 *
 * @returns a disposer that releases this call's claim exactly once.
 */
export function watchRestart(): () => void {
  watchOwners += 1
  if (watchTimer === undefined) {
    const timer: ReturnType<typeof setInterval> & UnrefTimer = setInterval((): void => {
      if (unconfirmed) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void (async (): Promise<void> => {
        if (await refreshRestart()) {
          watchFailures = 0
          return
        }
        watchFailures += 1
        if (watchFailures >= WATCH_FAILURES && snapshot.status === 'ready') markUnavailable()
      })()
    }, WATCH_POLL_MS)
    // A page-lifetime interval must not hold a Node process open (the verification
    // scripts load this artifact); browsers return a number and ignore the call.
    timer.unref?.()
    watchTimer = timer
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }
  }
  let released = false
  return () => {
    if (released) return
    released = true
    watchOwners -= 1
    if (watchOwners > 0) return
    watchOwners = 0
    if (watchTimer !== undefined) {
      clearInterval(watchTimer)
      watchTimer = undefined
    }
    watchFailures = 0
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }
}

/**
 * How often the status route is re-read while a restart is outstanding.
 *
 * Each read is one local POST on the authenticated channel, so it is cheap; two
 * seconds keeps the row's return from `Restarting…` visually prompt.
 */
export const RECOVERY_POLL_MS = 2000

/**
 * How long a restart may stay unconfirmed before the row stops claiming progress.
 *
 * A replacement Host takes a few seconds to boot. When it answers on another
 * address this page never sees it at all, so waiting silently is worse than
 * saying so and offering the one action that does help.
 */
export const RECOVERY_TIMEOUT_MS = 25_000

/** How a watched restart ended. */
export type RestartOutcome = 'reconnected' | 'timeout'

/**
 * Wait for a Host other than the one that accepted the restart.
 *
 * The pid is what distinguishes them: a restart terminates the Host that answered
 * before, so the first capability carrying a different pid comes from its
 * replacement. A read that fails means the Host is still leaving; a read that
 * answers with the same pid means it has not left yet. Both cases keep polling,
 * so no reconnect subscription is needed here for correctness — the event only
 * saves the first two-second wait.
 *
 * @param baselinePid - pid of the Host that accepted the restart, when known.
 * @param timeoutMs - how long to wait before reporting the restart as stalled.
 * @returns the outcome, having stored the new capability when one arrived.
 */
export async function awaitRestartedHost(
  baselinePid: number | undefined,
  timeoutMs: number = RECOVERY_TIMEOUT_MS,
): Promise<RestartOutcome> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => { setTimeout(resolve, RECOVERY_POLL_MS) })
    try {
      const response = await fetchStatus()
      // A body without a capability is not a replacement Host either, so it keeps
      // waiting the same way a failed read does.
      if (response !== undefined) {
        setRestartCapability(response.capability)
        if (baselinePid === undefined || response.capability.pid !== baselinePid) return 'reconnected'
      }
    } catch {
      // Expected while the Host is leaving; keep waiting.
    }
  }
  return 'timeout'
}

/**
 * Whether this page asked for a restart that no new Host has confirmed.
 *
 * The page outlives the Host that served it. When the replacement comes up on a
 * different address this page cannot reach it at all, so no answer is ever
 * coming and the only way forward is a reload. Every surface reads this flag to
 * decide whether to offer one. It is deliberately in-memory: after a reload the
 * page is current by definition and the question no longer exists.
 */
let unconfirmed = false
const unconfirmedListeners = new Set<() => void>()

/** Whether a restart from this page is still waiting for a new Host. */
export function restartUnconfirmed(): boolean {
  return unconfirmed
}

/** Subscribe to changes of the unconfirmed flag. */
export function subscribeUnconfirmed(listener: () => void): () => void {
  unconfirmedListeners.add(listener)
  return () => { unconfirmedListeners.delete(listener) }
}

/** Record that a restart was posted and no new Host has answered yet. */
export function markRestartUnconfirmed(): void {
  if (unconfirmed) return
  unconfirmed = true
  for (const listener of [...unconfirmedListeners]) listener()
}

/** Record that a new Host answered, so the page is current again. */
export function clearRestartUnconfirmed(): void {
  if (!unconfirmed) return
  unconfirmed = false
  for (const listener of [...unconfirmedListeners]) listener()
}

/**
 * Whether a restart from this page has been posted and not yet resolved.
 *
 * Shared here rather than kept in the action hook because more than one surface
 * can show the same state: a surface mounted after the restart started has to
 * read `Restarting…` as well, and it cannot see another surface's hook state.
 */
let restartInFlight = false
const pendingListeners = new Set<() => void>()

/** Whether a restart from this page is in flight. */
export function restartPending(): boolean {
  return restartInFlight
}

/** Subscribe to changes of the pending flag. */
export function subscribeRestartPending(listener: () => void): () => void {
  pendingListeners.add(listener)
  return () => { pendingListeners.delete(listener) }
}

/** Record whether a restart is in flight. */
export function markRestartPending(pending: boolean): void {
  if (restartInFlight === pending) return
  restartInFlight = pending
  for (const listener of [...pendingListeners]) listener()
}
