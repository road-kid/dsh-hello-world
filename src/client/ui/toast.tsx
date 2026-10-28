/**
 * A transient banner above the page, with an optional trailing action.
 *
 * The host reports the outcome of an operation in a banner rather than a dialog:
 * it never steals focus, it fades on its own, and an action inside it is the only
 * clickable part (the banner itself stays click-through so it cannot swallow a
 * click meant for the page). All of that is reproduced here, renamed under `dh-`.
 *
 * Rendered in place rather than portaled — `position: fixed` is enough to escape
 * the pane's clipping.
 */

import { useEffect } from 'react'
import type { CSSProperties, ReactElement } from 'react'

/** How long the banner stays legible before it starts to fade. */
const HOLD_MS = 3000

/** Fade length; also the unmount delay past the hold. */
const FADE_MS = 1000

/** One action appended to the banner's sentence. */
export interface ToastAction {
  /** Action text. */
  readonly label: string
  /** Separator printed before the action, for languages that need a space. */
  readonly prefix?: string
  /** Invoked on click. */
  readonly onClick: () => void
}

/** Props of {@link Toast}. */
export interface ToastProps {
  /** Sentence shown in the banner. */
  readonly text: string
  /** How long the banner stays before fading (default {@link HOLD_MS}). */
  readonly holdMs?: number
  /** Actions rendered after the sentence, followed by a full stop. */
  readonly actions?: readonly ToastAction[]
  /** Called once the banner has faded and is removed by its owner. */
  readonly onDone: () => void
}

/**
 * Render a transient banner.
 *
 * @param props - see {@link ToastProps}.
 * @returns the banner element.
 */
export function Toast({ text, holdMs = HOLD_MS, actions, onDone }: ToastProps): ReactElement {
  useEffect(() => {
    // The hold is a CSS custom property so the animation and the unmount timer
    // read the same number; the timer is the authority on removal. The property is
    // always passed explicitly (never left to a CSS fallback), so this component
    // holds the only copy of the duration.
    const timer = setTimeout(onDone, holdMs + FADE_MS)
    return () => { clearTimeout(timer) }
  }, [holdMs, onDone])

  return (
    <div
      className="dh-toast"
      role="alert"
      style={{ '--dh-toast-hold': `${holdMs}ms` } as CSSProperties & Record<'--dh-toast-hold', string>}
    >
      <span className="dh-toast-text">
        {text}
        {actions?.map(action => (
          <span key={action.label}>
            {action.prefix}
            <button type="button" className="dh-toast-action" onClick={action.onClick}>
              {action.label}
            </button>
          </span>
        ))}
      </span>
    </div>
  )
}
