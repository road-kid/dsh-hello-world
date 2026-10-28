/**
 * A centred, viewport-anchored dialog.
 *
 * Markup, geometry and keyboard contract are copied from the host's dialog: a
 * mask that closes on click, a card carrying `role="dialog"` / `aria-modal`, a
 * header with the title and a close control, the optional description, the body
 * and a right-aligned footer. Class names are renamed under `dh-`; only theme
 * tokens are used.
 *
 * The element is rendered in place (never portaled): `position: fixed` already
 * escapes the pane's clipping, so the plugin never writes DOM outside its own
 * component. Escape, Tab trapping and focus restoration come from
 * `dialog-layer.ts`; the initial-focus control is marked `data-modal-autofocus`.
 */

import { useId, useRef } from 'react'
import type { ReactElement, ReactNode } from 'react'

import { useDialogLayer } from './dialog-layer.ts'
import { CloseIcon } from './icon.tsx'

/** Props of {@link Modal}. */
export interface ModalProps {
  /** Whether the dialog is showing; false renders nothing. */
  readonly open: boolean
  /** Close command: the close control, the mask, or Escape. */
  readonly onClose: () => void
  /** Dialog heading; also the accessible name. */
  readonly title: string
  /** Localized accessible label for the close control. */
  readonly closeLabel: string
  /** Optional supporting sentence under the title. */
  readonly description?: string
  /** Dialog body; mark its initial-focus control with `data-modal-autofocus`. */
  readonly children?: ReactNode
  /** Action row, right-aligned. */
  readonly footer?: ReactNode
}

/**
 * Render a modal dialog.
 *
 * @param props - see {@link ModalProps}.
 * @returns the overlay tree, or `null` while closed.
 */
export function Modal({ open, onClose, title, closeLabel, description, children, footer }: ModalProps): ReactElement | null {
  const dialog = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useDialogLayer(dialog, open, onClose)

  if (!open) return null

  return (
    <div className="dh-modal-root" role="presentation">
      <div className="dh-modal-mask" aria-hidden="true" onClick={onClose} />
      <div
        ref={dialog}
        tabIndex={-1}
        className="dh-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="dh-modal-content">
          <div className="dh-modal-header">
            <h2 className="dh-modal-title" id={titleId}>{title}</h2>
            <button type="button" className="dh-modal-close" aria-label={closeLabel} onClick={onClose}>
              <CloseIcon size={14} />
            </button>
          </div>
          {description !== undefined && description !== '' && (
            <p className="dh-modal-description">{description}</p>
          )}
          {children !== undefined && <div className="dh-modal-body">{children}</div>}
        </div>
        {footer !== undefined && <div className="dh-modal-footer">{footer}</div>}
      </div>
    </div>
  )
}
