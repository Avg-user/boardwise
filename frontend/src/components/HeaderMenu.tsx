import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { User } from '../api/types.ts'
import DisplaySettingsDialog from './DisplaySettings.tsx'
import LanguageSwitcher from './LanguageSwitcher.tsx'

/** Up to two initials from a username: "victim" → "V", "jane_doe" → "JD". */
function initials(name: string): string {
  const parts = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0]?.[0] ?? '?')).toUpperCase()
}

type HeaderMenuProps = {
  user: User | null
  onSignOut: () => void
}

/**
 * One header button for account and preferences: language, display settings and sign out.
 * A disclosure (button plus panel), not an ARIA menu, because it holds a dropdown and
 * ordinary buttons that should keep their usual keyboard behaviour.
 */
function HeaderMenu({ user, onSignOut }: HeaderMenuProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [displayOpen, setDisplayOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  function close({ returnFocus }: { returnFocus: boolean }) {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  // Close when clicking or tapping anywhere outside the menu.
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
      close({ returnFocus: true })
    }
  }

  function openDisplaySettings() {
    close({ returnFocus: false })
    setDisplayOpen(true)
  }

  function closeDisplaySettings() {
    setDisplayOpen(false)
    // The menu item that opened it is hidden now, so bring focus back to the menu button.
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  return (
    <div
      ref={wrapperRef}
      className="header-menu"
      onKeyDown={handleKeyDown}
      // Tabbing out of the menu closes it.
      onBlur={(event) => {
        if (open && !wrapperRef.current?.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      {/* A plain round button, like other chat apps: initials when signed in, "⋯" when not.
          No border or arrow, so it doesn't read as a form dropdown. */}
      <button
        ref={triggerRef}
        type="button"
        className="header-menu__trigger"
        aria-label={user ? t('menu.account', { name: user.username }) : t('menu.settings')}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        {user ? (
          <span className="header-menu__avatar" aria-hidden="true">
            {initials(user.username)}
          </span>
        ) : (
          <svg className="header-menu__more" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        )}
      </button>
      <div id={panelId} className="header-menu__panel" hidden={!open}>
        {user && (
          <p className="header-menu__who">
            {t('menu.signedInAs')} <strong>{user.username}</strong>
          </p>
        )}
        <LanguageSwitcher />
        <button type="button" className="header-menu__item" onClick={openDisplaySettings}>
          {t('display.title')}
        </button>
        {user && (
          <>
            <hr className="header-menu__divider" />
            <button
              type="button"
              className="header-menu__item"
              onClick={() => {
                close({ returnFocus: false })
                onSignOut()
              }}
            >
              {t('auth.signOut')}
            </button>
          </>
        )}
      </div>
      <DisplaySettingsDialog open={displayOpen} onClose={closeDisplaySettings} />
    </div>
  )
}

export default HeaderMenu
