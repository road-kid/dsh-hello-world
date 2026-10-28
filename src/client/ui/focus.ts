/**
 * Focus presentation for automatic entry and restoration.
 *
 * Copied behaviour, not copied code: the theme suppresses focus outlines while
 * `data-dsh-automatic-focus` is present, so a dialog that focuses its first
 * control (or returns focus to the button that opened it) does not flash a ring
 * the user did not ask for. Keyboard navigation restores normal styling.
 */

/** Elements per currently-focused node, so a new automatic focus releases the old. */
const releases = new WeakMap<HTMLElement, () => void>()

/** Keys that mean "the user is navigating": the ring comes back. */
const navigationKeys = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'])

/**
 * Focus an automatic destination without a focus outline until keyboard navigation or blur.
 *
 * @param element - control or container receiving automatic focus.
 * @param options - browser focus options, including scroll preservation.
 */
export function focusWithoutRing(element: HTMLElement, options?: FocusOptions): void {
  releases.get(element)?.()
  const release = (): void => {
    element.removeAttribute('data-dsh-automatic-focus')
    element.removeEventListener('blur', release)
    element.removeEventListener('keydown', navigate, true)
    releases.delete(element)
  }
  const navigate = (event: KeyboardEvent): void => {
    if (!event.isComposing && !event.ctrlKey && !event.altKey && !event.metaKey && navigationKeys.has(event.key)) {
      release()
    }
  }
  releases.set(element, release)
  element.setAttribute('data-dsh-automatic-focus', '')
  element.addEventListener('blur', release)
  element.addEventListener('keydown', navigate, true)
  element.focus(options)
  if (!element.matches(':focus')) release()
}
