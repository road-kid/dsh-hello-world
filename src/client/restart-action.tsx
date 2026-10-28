/**
 * The restart action in the settings header.
 *
 * One button, beside “Open DSH terminal” in `settings.action`. The label and the
 * disabled state come from the shared `restartEntryView`, so this surface reads
 * exactly like every other one; the confirmation dialog and the toast are handed
 * back by `useRestartAction` and rendered from here, in place.
 */

import type { ReactElement } from 'react'

import { Button } from './ui/button.tsx'
import { useRestartAction } from './use-restart.tsx'
import type { Translate } from './types.ts'

/** Props the seat injects: the translator bound to this package's namespace. */
export interface RestartActionProps {
  readonly t: Translate
}

/**
 * Render the restart action.
 *
 * @param props.t - translator bound to this package's locale namespace.
 * @returns the button and, while a confirmation or a notice is up, its overlay.
 */
export function RestartActionButton({ t }: RestartActionProps): ReactElement {
  const action = useRestartAction(t)
  const { label, reason, disabled } = action.view
  // The reason (a refusal, a running-task warning) is the whole explanation a
  // disabled button cannot otherwise give, so it is both the tooltip and the
  // accessible name — and the button stays focusable (aria-disabled, not the
  // native `disabled`) so a keyboard user can still reach it.
  const description = reason ?? label
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-disabled={disabled || undefined}
        aria-label={description}
        title={description}
        onClick={() => { if (!disabled) action.activate() }}
      >
        {label}
      </Button>
      {action.overlays}
    </>
  )
}
