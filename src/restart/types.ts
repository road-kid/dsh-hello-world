/**
 * Minimal structural views of the host services this plugin only *reads*.
 *
 * The bundle deliberately carries no `@deepseek-ai/dsh-*` type dependency: those
 * packages are not installed next to a plugin, and a hard import would make the
 * plugin unloadable if a future harness reorganizes them. The few shapes used
 * here are declared structurally, mirroring the official desktop quit-inspection
 * predicate so the meaning of "active work" cannot drift.
 */

/** One job, as far as interruption matters (`JobStatus` subset). */
export interface JobView {
  readonly status?: string
}

/** The `webServer` service, as far as the plugin needs it. */
export interface WebServerView {
  readonly port?: number
  readonly host?: string
  readonly protocol?: string
}

/** The `appExit` service: bounded exit request wired to the launcher's shutdown. */
export type AppExitView = (code: number) => void
