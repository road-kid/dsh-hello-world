import type { ReactElement } from 'react'

/**
 * The dialog's close glyph.
 *
 * Copied from the product's icon set so the dialog matches the shipped controls
 * exactly. Copying is the documented pattern: a plugin must not load the
 * UI-primitives package at runtime, so it vendors the markup it needs and keeps
 * only token-based colours.
 */

/** Close glyph for the dialog's own dismiss control (two crossed strokes). */
const CLOSE_PATH = 'M20 20 L44 44 M44 20 L20 44'

/**
 * Render the dialog's close glyph.
 *
 * @param props.size - edge length in CSS pixels.
 * @returns a decorative, `currentColor` SVG.
 */
export function CloseIcon({ size = 14 }: { readonly size?: number }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d={CLOSE_PATH} stroke="currentColor" strokeWidth={6} strokeLinecap="round" />
    </svg>
  )
}
