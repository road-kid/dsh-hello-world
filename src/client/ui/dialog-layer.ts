/**
 * Dialog keyboard ownership and focus lifetime.
 *
 * Copied behaviour from the host's dialog layer: only the topmost dialog answers
 * Escape, Tab is trapped inside it, and closing restores the focus that was
 * taken when it opened. Small on purpose — this plugin opens at most one dialog
 * at a time and has no portaled menus, so the layer stack only needs to keep
 * nested dialogs (a dialog opened from a dialog) from fighting over the keyboard.
 */

import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'

import { focusWithoutRing } from './focus.ts'

/** One registered dialog per document, oldest first. */
const layers = new WeakMap<Document, HTMLElement[]>()

/** What a Tab press may land on inside a dialog. */
const FOCUSABLE = [
  'button:not(:disabled)',
  'input:not(:disabled)',
  'textarea:not(:disabled)',
  'select:not(:disabled)',
  'a[href]',
  '[tabindex="0"]',
].join(', ')

/**
 * Give only the top dialog Escape and Tab ownership, then restore its previous focus.
 *
 * @param dialog - the dialog element.
 * @param open - whether this layer is active.
 * @param onClose - Escape or application close action.
 */
export function useDialogLayer(dialog: RefObject<HTMLElement | null>, open: boolean, onClose: () => void): void {
  // The listener closes over a ref so a re-rendered callback never needs a
  // re-subscription (which would drop keyboard ownership for one commit).
  const close = useRef(onClose)
  close.current = onClose

  useLayoutEffect(() => {
    const element = dialog.current
    if (!open || element === null) return

    const document = element.ownerDocument
    const previous = document.activeElement
    const stack = layers.get(document) ?? []
    layers.set(document, stack)
    stack.push(element)

    const initial = element.querySelector<HTMLElement>('[data-modal-autofocus]')
      ?? element.querySelector<HTMLElement>(FOCUSABLE)
      ?? element
    if (!element.contains(document.activeElement)) focusWithoutRing(initial)

    const keydown = (event: KeyboardEvent): void => {
      // A newer dialog owns the keyboard; never double-handle a composed or
      // already-handled key, and never steal a browser/OS shortcut.
      if (stack.at(-1) !== element || event.defaultPrevented || event.isComposing
        || event.ctrlKey || event.altKey || event.metaKey) return

      if (event.key === 'Escape' && !event.shiftKey) {
        event.preventDefault()
        if (!event.repeat) close.current()
        return
      }
      if (event.key !== 'Tab') return

      const items = [...element.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter(item => !item.closest('[inert], [hidden]'))
      const first = items[0] ?? element
      const last = items.at(-1) ?? element
      const atEdge = event.shiftKey ? document.activeElement === first : document.activeElement === last
      if (document.activeElement === element || !element.contains(document.activeElement) || atEdge) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      }
    }

    document.addEventListener('keydown', keydown)
    return () => {
      const wasTop = stack.at(-1) === element
      // `indexOf` can answer -1 (the element was already removed, e.g. by a
      // second cleanup after a fast remount); `splice(-1, 1)` would then drop the
      // top of the stack — another, still-open dialog — and leave Escape and the
      // focus restore pointing at the wrong layer.
      const index = stack.indexOf(element)
      if (index !== -1) stack.splice(index, 1)
      document.removeEventListener('keydown', keydown)
      if (stack.length === 0) layers.delete(document)
      if (!wasTop) return
      // Return focus to whatever opened the dialog, unless it has left the page;
      // the dialog underneath is the next-best destination.
      const target = previous instanceof HTMLElement && previous.isConnected
        ? previous
        : stack.at(-1)
      if (target !== undefined) focusWithoutRing(target)
    }
  }, [dialog, open])
}
