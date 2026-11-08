import { useEffect, useId, useRef, type ReactNode } from 'react'

type DialogProps = {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  /** Mounted only while open, so forms inside start fresh each time. Mark the element
   *  that should get focus with `data-autofocus`. */
  children: ReactNode
}

/**
 * A small modal pop-up. The browser's dialog element traps focus, closes on Escape,
 * and returns focus to whatever opened it. Clicking the backdrop also closes it.
 */
function Dialog({ open, onClose, title, description, children }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const headingId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (open && !dialog?.open) {
      dialog?.showModal()
      // showModal() focuses the first field. Move focus to the one marked for it instead.
      dialog?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    } else if (!open && dialog?.open) {
      dialog.close()
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby={headingId}
      onClose={onClose}
      // A click on the dialog element itself, rather than its contents, is a click on the backdrop.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dialog__body">
        <h2 id={headingId}>{title}</h2>
        {description && <p className="dialog__description">{description}</p>}
        {open && children}
      </div>
    </dialog>
  )
}

export default Dialog
