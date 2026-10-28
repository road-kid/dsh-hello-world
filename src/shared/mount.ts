import { writeDiagnostic } from '../diag.ts'
import { PLUGIN_VERSION } from './protocol.ts'

/**
 * Mount and unmount logging for the component entries.
 *
 * The two component packages are separate plugins but they open and close the same
 * way, and they used to say so in two different ways — one built the line from a
 * three-part concatenation, the other from a template string, and only one of them
 * logged a ppid. A support log is read by whoever is debugging a restart at the
 * worst possible moment; making both entries emit the same shape means the reader
 * never has to remember which component wrote which line.
 *
 * Nothing here may throw: it runs at mount time, and a logging failure must never
 * be the reason a component refuses to load.
 */

/** Which component a mount line describes. */
export interface MountTag {
  /** Package name as the loader knows it, e.g. `dsh-quick-restart`. */
  readonly plugin: string
  /** Row name as the plugin manager shows it, e.g. `quick-restart`. */
  readonly component: string
}

/**
 * Write the "mounting" line for one component.
 *
 * @param tag - the component that is mounting.
 * @param detail - component-specific facts, appended after the process facts.
 */
export function logMount(tag: MountTag, detail?: string): void {
  const extra = detail === undefined || detail === '' ? '' : ` ${detail}`
  writeDiagnostic(
    `${tag.plugin}@${PLUGIN_VERSION} mounting ${tag.component}: `
    + `pid=${String(process.pid)} ppid=${String(process.ppid)} platform=${process.platform}${extra}`,
  )
}

/**
 * Write the "unmounting" line for one component.
 *
 * The line matters because a component can disappear from the UI without an error:
 * "unmounting" is the difference between "the user switched it off" and "the Host
 * died".
 *
 * @param tag - the component that is unmounting.
 */
export function logUnmount(tag: MountTag): void {
  writeDiagnostic(`${tag.plugin}@${PLUGIN_VERSION} unmounting ${tag.component}`)
}
