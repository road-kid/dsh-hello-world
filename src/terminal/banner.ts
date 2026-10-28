import { PRODUCT_NAME } from './identity.ts'

/**
 * The text the terminal prints before the prompt.
 *
 * Pure layout: no filesystem, no spawning. Everything the banner needs is passed
 * in, which is what lets the plan builders and the tests print the exact lines a
 * user will see without opening a window.
 *
 * ## Layout
 *
 * The layout follows what the established command-line tools print (Vite, Poetry
 * `env info`, create-react-app, uvicorn): the identity line first, then one
 * `Key: value` block with a single space after each colon, then a note about the
 * commands, then the `Commands:` block indented by two spaces. Groups are separated
 * by exactly one blank line; there is no leading blank line, no box drawing and no
 * colour, because the text is also read in scrollback and in logs.
 *
 * The fact block is not column-aligned: padding every key to the widest one buys a
 * straight left edge for the values, but pays for it with a wide gap after the
 * short keys, and the gap grows with every longer key added.
 *
 * The command that stops this Host is part of the fact block, in parentheses
 * after the pid, because it is a fact about that pid and not a step to take.
 *
 * Every fact answers a different question, which is the test a line has to pass to
 * be printed: `Profile:` is which profile the shell's `dsh` edits, `DSH home:` is
 * the directory that holds every profile, `Directory:` is where the running DSH
 * itself lives — the installation directory of a packaged app, the checkout a
 * source run was started from — and `Host pid:` is which process to stop.
 *
 * The profile directory is not a fact: it is `DSH home` + `profiles` + `Profile`,
 * so printing it would restate the three lines around it. The shell still starts
 * there — that is what `TerminalBanner.profileDirectory` is for, and the fact block
 * is not the place for it.
 *
 * The note about `--profile` sits immediately before the command list it qualifies,
 * not after it: it is read as a condition on those commands.
 *
 * The command list is data and carries no indentation: the two-space indent is
 * this module's business, applied once when the list is printed. That keeps the
 * data usable by anything that wants the bare commands.
 */

/** The text a terminal prints before the prompt. */
export interface TerminalBanner {
  /** The directory the shell starts in: the DSH profile directory this Host owns. Not printed — `DSH home` and `Profile` already name it. */
  readonly profileDirectory: string
  /** The root of the DSH this Host runs from: the installation directory of a packaged app, the checkout root of a source run. */
  readonly applicationDirectory: string
  /** The DSH home that holds the profiles, printed as `DSH home`; omitted when the Host does not name one. */
  readonly home?: string
  /** The DSH profile the terminal's `dsh` commands edit. */
  readonly profile: string
  /** The Host process that owns the profile and can be stopped from here. */
  readonly hostPid: number
  /** Product name used for the title line, e.g. `DeepSeek Harness`. */
  readonly product?: string
  /** Product version used for the title line, when the installation names one. */
  readonly version?: string
}

/**
 * The command lines advertised to the user.
 *
 * These are the installation's own commands, without the `--profile` flag (the
 * shim fills it in for `plugin`). Order and wording follow the deployment's
 * terminal banner.
 *
 * @returns the command examples, without layout.
 */
export function profileCommands(): readonly string[] {
  return [
    'dsh --dump-config',
    'dsh plugin add <third-party-plugin>',
    'dsh plugin remove <third-party-plugin>',
    'dsh plugin update',
  ]
}

/**
 * The command that ends this Host, printed in parentheses after its pid.
 *
 * Only real commands appear here. A previous version printed
 * `quit <product>` for the desktop case, which reads like a command but is not
 * one: the shell answers `CommandNotFoundException`. Signalling the pid is what
 * actually stops a Host, on every deployment, so that is what the line shows.
 * A desktop Host is a child of the application and the application starts
 * another one, which is why the fact is phrased as stopping the Host rather than
 * quitting the app.
 *
 * The command is prefixed with what it does, so a reader who does not recognise
 * `taskkill` still knows the parenthesised part is the way to stop the Host: the
 * parentheses read as `<what it does>: <the command to type>`.
 *
 * @param pid - the Host process.
 * @param platform - `win32`, `darwin`, or `linux`.
 * @returns the explanation and the command, without the surrounding parentheses.
 */
function stopCommand(pid: number, platform: NodeJS.Platform): string {
  return `End task: ${platform === 'win32' ? `taskkill /PID ${pid} /F` : `kill ${pid}`}`
}

/**
 * The terminal's welcome text.
 *
 * Each fact is one `Key: value` line with a single space after the colon. Long
 * keys push their values right, which is accepted: the alternative — padding
 * every key to the widest one — buys a straight left edge for values at the cost
 * of a wide gap after the short keys, and the gap grows every time a longer key
 * is added.
 *
 * @param banner - resolved values for the printed lines.
 * @param platform - `win32`, `darwin`, or `linux`.
 * @returns the lines, exactly as printed.
 */
export function bannerLines(banner: TerminalBanner, platform: NodeJS.Platform = process.platform): readonly string[] {
  const product = banner.product ?? PRODUCT_NAME
  const title = banner.version === undefined || banner.version.length === 0 ? product : `${product} ${banner.version}`

  const facts: [key: string, value: string][] = [['Profile:', banner.profile]]
  if (banner.home !== undefined && banner.home.length > 0) facts.push(['DSH home:', banner.home])
  facts.push(['Directory:', banner.applicationDirectory])
  facts.push(['Host pid:', `${banner.hostPid} (${stopCommand(banner.hostPid, platform)})`])

  const lines: string[] = [title]
  for (const [key, value] of facts) lines.push(`${key} ${value}`)
  lines.push('')
  lines.push(`Plugin commands without --profile modify the ${banner.profile} profile`)
  lines.push('')
  lines.push('Commands:')
  for (const command of profileCommands()) lines.push(`  ${command}`)
  return lines
}
