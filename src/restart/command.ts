import type { Context } from '@deepseek-ai/cordis'

import type { ConfigShape } from '../config.ts'
import { messageOf, writeDiagnostic } from '../diag.ts'
import { refusalFor, scheduleRestart } from './index.ts'

/**
 * The `/restart` slash command.
 *
 * The command is the *typed* form of the restart: it appears in the `/` menu as
 * soon as it is registered (the command runtime lists registered commands to the
 * client), so the plugin needs no client code for it. Typing the command **is**
 * the confirmation, so `confirmBeforeRestart` does not apply here.
 *
 * Usage:
 *
 * - `/restart` — refuse if the Host has active work;
 * - `/restart --force` — ignore active work and restart anyway. A typed flag is
 *   explicit intent, so it may override the "busy" refusal — but never the
 *   absolute ones (disabled, supervisor, attached debugger): those describe a
 *   deployment in which this process does not own its own life.
 */

/** Name used in the `/` menu; must match `COMMAND_NAME` (`/^[a-z][a-z0-9_-]*$/u`). */
export const COMMAND_NAME = 'restart'

/** What the command runtime answers with: text for the transcript, or an error. */
type CommandReply =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** The command service, as far as this module needs it. */
interface CommandsService {
  register(definition: {
    readonly definitionId?: unknown
    readonly name: string
    readonly description: string
    readonly input?: { readonly hint: string }
    readonly handler: (invocation: {
      readonly commandId: unknown
      readonly agent: unknown
      readonly rawInput: string
      readonly attachments: readonly unknown[]
      readonly signal: AbortSignal
    }) => CommandReply
  }): () => void
}

/**
 * End a sentence with exactly one period.
 *
 * Refusal sentences come from the policy rules and failure text from arbitrary
 * errors, and some of them already end with a period. Appending one blindly yields
 * "..", which reads like a typo in the transcript.
 *
 * @param text - the sentence body.
 * @returns the body with exactly one trailing period.
 */
function sentence(text: string): string {
  const trimmed = text.trim()
  return trimmed.endsWith('.') ? trimmed : `${trimmed}.`
}

/** Split the raw input into a flag set; unknown flags are reported as usage errors. */
function parseFlags(raw: string): { force: boolean } | { error: string } {
  let force = false
  for (const token of raw.trim().split(/\s+/u)) {
    if (token === '') continue
    if (token === '--force' || token === '-f') {
      force = true
      continue
    }
    return { error: `Unknown option "${token}". Usage: /restart [--force]` }
  }
  return { force }
}

/**
 * Register `/restart` on the command runtime.
 *
 * @param ctx - context that owns the registration (disposed with it).
 * @param config - live configuration reader.
 */
export function registerRestartCommand(ctx: Context, config: () => ConfigShape): void {
  try {
    // Same late-mounting problem as the routes: `commands` may be provided after
    // this plugin mounts, so wait for it instead of sampling it once.
    ctx.inject(['commands'], (scoped: Context) => { attach(scoped, config) })
  } catch (error) {
    writeDiagnostic(`command: could not wait for ctx.commands: ${messageOf(error)}`)
  }
}

/** Register the command once the command runtime is available. */
function attach(ctx: Context, config: () => ConfigShape): void {
  let commands: CommandsService | undefined
  try {
    commands = ctx.get('commands') as CommandsService | undefined
  } catch {
    commands = undefined
  }
  if (commands === undefined) {
    // Not an error: an older harness without the command runtime simply has no
    // `/restart`; the settings-header button is the primary surface.
    writeDiagnostic('command: ctx.commands is unavailable; /restart is not registered')
    return
  }

  try {
    const dispose = commands.register({
      name: COMMAND_NAME,
      description: 'Restart the DeepSeek Harness Host; relaunches the desktop application when running inside it',
      input: { hint: '[--force]' },
      handler: (invocation): CommandReply => {
        const settings = config()
        const flags = parseFlags(invocation.rawInput)
        if ('error' in flags) return { kind: 'error', text: flags.error }

        const denied = refusalFor(ctx, settings)
        if (denied !== undefined) {
          const overridable = flags.force && denied.reason === 'busy'
          if (!overridable) {
            return { kind: 'error', text: sentence(`Restart refused: ${denied.error}`) }
          }
        }
        try {
          const plan = scheduleRestart(ctx, settings)
          const what = plan.target === 'desktop'
            ? 'the desktop application will relaunch'
            : `this Host will be replaced (${plan.command ?? 'same command line'})`
          const log = plan.logFile ?? 'the plugin log'
          return { kind: 'success', text: `Restart scheduled: ${what}. Log: ${log}` }
        } catch (error) {
          writeDiagnostic(`command: restart failed to arm: ${messageOf(error)}`)
          return { kind: 'error', text: sentence(`Restart failed: ${messageOf(error)}`) }
        }
      },
    })
    ctx.effect(() => dispose, `dsh-hello-world: /${COMMAND_NAME} command`)
  } catch (error) {
    writeDiagnostic(`command: could not register /${COMMAND_NAME}: ${messageOf(error)}`)
  }
}
