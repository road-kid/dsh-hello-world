/**
 * Button: a token-styled button with the host's four variants and two sizes.
 *
 * Markup and CSS are copies of the host control (a `<button type="button">` whose
 * classes select a fill family and a height), renamed under the `dh-` prefix so
 * the two stylesheets cannot collide. Only `--dsw-alias-*` / `--dsw-radius-*`
 * tokens are referenced, so light, dark and high-contrast themes follow the shell.
 */

import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

/** Visual family, each backed by its own token set. */
export type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'toolbar'

/** Control height: `md` is a 36px field, `sm` a 28px one. */
export type ButtonSize = 'md' | 'sm'

/** Props of {@link Button}: the native button plus presentation only. */
export type ButtonProps = {
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  readonly className?: string | undefined
  readonly children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>

/**
 * Render a button.
 *
 * @param props.variant - visual family (default `ghost`).
 * @param props.size - `md` (36px, 12px corners) or `sm` (28px, 8px corners).
 * @param ref - native button, for focus management and overlay anchors.
 * @returns the button element; native attributes pass through.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'md', className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={['dh-button-base', `dh-button-${variant}`, `dh-button-${size}`, className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </button>
  )
})
