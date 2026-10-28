import z from '@deepseek-ai/schemastery'

/**
 * Plugin configuration.
 *
 * Every field is `.volatile()`: the settings service treats those fields as
 * live-updatable without remounting the plugin, and schemastery turns each into a
 * `{ get() }` reference. The Host therefore reads the config through
 * {@link snapshotConfig} instead of touching fields directly.
 *
 * The plugin ships no settings form. The values live in the `config` block of the
 * `quick-restart` row that `cordis.patch.yml` inserts into the profile patch — that
 * row id, not the bundle entry, is the place an operator edits.
 *
 * Every field also carries a `.description()`, because schemastery renders those
 * strings as the help text of a generated settings form. The descriptions are in
 * English: schema text is source, and this repository keeps source in English.
 *
 * Defaults are deliberately conservative: installing the plugin changes nothing
 * until somebody presses the row, and a restart is always a two-step action
 * (open the confirm dialog, then confirm) unless the user turns that off.
 */

/** Plain-value shape of the configuration, as the Host consumes it. */
export interface ConfigShape {
  /** Policy switch: off refuses with `disabled` while the row explains it. */
  enabled: boolean
  /** Ask before restarting (a restart interrupts running work). */
  confirmBeforeRestart: boolean
  /** Refuse while the Host has running work (agents, queued turns, jobs). */
  refuseWhileBusy: boolean
  /** Allow a restart under a process supervisor (systemd, launchd, pm2). */
  allowSupervisor: boolean
  /** Delay between claiming the restart and leaving, so the answer reaches the page. */
  delayMs: number
  /** How long the watchdog waits for old processes and the port before forcing the issue. */
  waitTimeoutMs: number
  /** How long a replacement has to prove it came up. */
  settleTimeoutMs: number
}

/**
 * Schema, as the loader runs it.
 *
 * Deliberately *not* annotated `z<ConfigShape>`: a volatile field's declared
 * output type is `Volatile<T>`, so an annotation with plain field types does not
 * typecheck. The declared output shape therefore stays inferred, and the Host
 * reads plain values through {@link snapshotConfig} — the one place that knows
 * about the `{ get() }` reference form.
 *
 * The numeric bounds are enforced here rather than only clamped in
 * {@link snapshotConfig}: a config file that says `waitTimeoutMs: 0` is a mistake,
 * and the loader should refuse it with a message instead of silently running with
 * a value the operator never chose.
 */
export const Config = z.object({
  /**
   * Policy switch: may this deployment restart itself?
   *
   * Off makes the capability refuse with the localized `disabled` reason, which
   * the row renders as a disabled entry naming the operator's decision. It is a
   * *policy* gate, not a lifecycle gate: the route surface stays mounted, because
   * a capability that cannot be queried cannot explain why it is off. Unloading
   * the component — its routes and its client bundle — is the component switch in
   * the plugin manager, and that one is per package and immediate.
   */
  enabled: z.boolean().default(true)
    .description('Allow this deployment to restart itself. Off keeps the row visible and explains why it refuses.')
    .volatile(),

  /**
   * Ask for confirmation before restarting.
   *
   * A restart interrupts every running agent, queued turn and background job in
   * this Host, so the default is on. Turning it off makes the row a one-click
   * restart (still refusing while work is active, see `refuseWhileBusy`).
   */
  confirmBeforeRestart: z.boolean().default(true)
    .description('Ask before restarting, because a restart interrupts running work.')
    .volatile(),

  /**
   * Refuse while the Host has active work (running agents, queued turns, jobs).
   *
   * Off by default, matching the desktop shell's own quit prompt: interrupting
   * work is what the user is asking for, and the confirmation dialog names how
   * many tasks will be interrupted before anything happens. Turn it on for a
   * deployment where a restart must never cut a turn short.
   *
   * Reporting "no work" when the plugin cannot see the work services would be a
   * lie, so when those services are missing the count is reported as unknown
   * (`activeTasks: -1`) and a strict deployment still refuses.
   */
  refuseWhileBusy: z.boolean().default(false)
    .description('Refuse to restart while agents, queued turns or background jobs are running.')
    .volatile(),

  /**
   * Allow a restart under a process supervisor (systemd, launchd, pm2).
   *
   * Refused by default: a supervisor with `KillMode=control-group` kills the
   * detached helper along with the Host, and `Restart=on-failure` would fight a
   * manual relaunch. An operator who knows their unit belongs to a plain
   * `Restart=always` service can turn this on.
   */
  allowSupervisor: z.boolean().default(false)
    .description('Allow a restart under systemd, launchd or pm2; the supervisor may kill or fight the replacement.')
    .volatile(),

  /**
   * Delay between claiming the restart and leaving the process.
   *
   * The HTTP answer must reach the page before the process disappears; 250 ms is
   * enough for a loopback response and short enough to feel instant.
   */
  delayMs: z.number().default(250).min(0)
    .description('Milliseconds between answering the request and leaving the process, so the answer reaches the page.')
    .volatile(),

  /**
   * How long the detached helper waits for the old processes to disappear (and,
   * for a command-line Host, for the listening port to be released) before it
   * force-kills them and launches anyway.
   */
  waitTimeoutMs: z.number().default(30_000).min(1_000)
    .description('Milliseconds the watchdog waits for the old processes and the port before forcing the issue.')
    .volatile(),

  /**
   * How long the helper keeps checking that a command-line replacement actually
   * bound the port before it declares the restart failed and writes that to the
   * log. A failed restart is never silent: the log path is shown in the UI.
   */
  settleTimeoutMs: z.number().default(30_000).min(1_000)
    .description('Milliseconds a replacement has to bind its port before the restart counts as failed.')
    .volatile(),
})

/** Read one field, tolerating both a volatile reference and a plain value. */
function read<T>(value: unknown, fallback: T): T {
  if (value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function') {
    const resolved = (value as { get(): unknown }).get()
    return resolved === undefined ? fallback : resolved as T
  }
  return value === undefined ? fallback : value as T
}

/**
 * An integer no smaller than `minimum`, from whatever the settings form stored.
 *
 * The name says exactly what it does. It used to be called `positive`, which was
 * wrong twice over: zero is a legal value for `delayMs`, and the function never
 * rejected anything — it floors it.
 *
 * @param value - stored value, possibly a volatile reference.
 * @param fallback - used when the value is not a finite number.
 * @param minimum - floor, which the schema also enforces for a real config.
 * @returns the floored integer.
 */
function atLeastInteger(value: unknown, fallback: number, minimum: number): number {
  const numeric = Number(read<number>(value, fallback))
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(minimum, Math.trunc(numeric))
}

/**
 * Take one immutable snapshot of the plugin configuration.
 *
 * Cordis runs the config through the schema before `apply`, so a validated config
 * carries `{ get() }` references. A hand-built config (tests, a selftest) carries
 * plain values instead; both are accepted so the Host never throws on a config
 * shape. The floors here are a second line of defence for those hand-built
 * configs; a real config is already bounded by the schema.
 *
 * @param config - resolved configuration object.
 * @returns frozen plain values.
 */
export function snapshotConfig(config: unknown): ConfigShape {
  const source = (config ?? {}) as Readonly<Record<string, unknown>>
  return Object.freeze({
    enabled: read<boolean>(source.enabled, true) !== false,
    confirmBeforeRestart: read<boolean>(source.confirmBeforeRestart, true) !== false,
    refuseWhileBusy: read<boolean>(source.refuseWhileBusy, false) === true,
    allowSupervisor: read<boolean>(source.allowSupervisor, false) === true,
    delayMs: atLeastInteger(source.delayMs, 250, 0),
    waitTimeoutMs: atLeastInteger(source.waitTimeoutMs, 30_000, 1_000),
    settleTimeoutMs: atLeastInteger(source.settleTimeoutMs, 30_000, 1_000),
  })
}
