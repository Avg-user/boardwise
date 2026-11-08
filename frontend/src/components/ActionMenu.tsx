import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import Icon from './Icon.tsx'

export type ActionMenuItem = {
  label: string
  onSelect: () => void
  disabled?: boolean
  /** Destructive actions (close, delete) are set apart in the danger colour. */
  danger?: boolean
}

type ActionMenuProps = {
  /** Accessible name for the "⋯" button, e.g. "More actions for this issue". */
  label: string
  items: ActionMenuItem[]
  /** Optional visible text beside the dots. */
  children?: ReactNode
  /** Lets the caller move focus back to the trigger, e.g. after an inline form closes. */
  triggerRef?: RefObject<HTMLButtonElement | null>
}

/**
 * A "⋯" button that opens a short list of actions. A disclosure (button plus panel) like the
 * header menu, not an ARIA menu, so the items keep ordinary button behaviour.
 */
function ActionMenu({ label, items, children, triggerRef: externalRef }: ActionMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const ownRef = useRef<HTMLButtonElement>(null)
  const triggerRef = externalRef ?? ownRef
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  return (
    <div
      ref={wrapperRef}
      className="action-menu"
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        if (open && !wrapperRef.current?.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={children ? 'button button--secondary action-menu__trigger' : 'icon-button'}
        aria-label={children ? undefined : label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        {children}
        <Icon name="more" />
      </button>
      <div id={panelId} className="action-menu__panel" hidden={!open}>
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            className={item.danger ? 'action-menu__item action-menu__item--danger' : 'action-menu__item'}
            disabled={item.disabled}
            onClick={() => {
              setOpen(false)
              // The panel closes first, so focus can go back to the trigger before a dialog opens.
              triggerRef.current?.focus()
              item.onSelect()
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default ActionMenu
