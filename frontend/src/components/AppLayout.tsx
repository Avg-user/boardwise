import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { logout } from '../api/auth.ts'
import { UNREAD_KEY, unreadCount } from '../api/messages.ts'
import type { User, UserRole } from '../api/types.ts'
import { endSessionNow } from '../auth/privacy.ts'
import { useIdleLock } from '../auth/useIdleLock.ts'
import { getHome, useCurrentUser } from '../auth/useCurrentUser.ts'
import { CURRENT_USER_KEY, clearSession, queryClient } from '../queryClient.ts'
import HeaderMenu from './HeaderMenu.tsx'
import LockScreen from './LockScreen.tsx'
import QuickExit from './QuickExit.tsx'
import { OwlMark } from './brand/Owl.tsx'
import { resetSpeaking } from './case/readAloud.ts'

const NAV_ITEMS = {
  victim: [
    { to: '/', labelKey: 'nav.issues' },
    { to: '/lawyers', labelKey: 'nav.lawyers' },
    { to: '/messages', labelKey: 'nav.messages' },
    { to: '/workplace', labelKey: 'nav.workplace' },
  ],
  hr: [{ to: '/hr', labelKey: 'nav.hr' }],
  law_firm: [
    { to: '/firm', labelKey: 'nav.firm' },
    { to: '/messages', labelKey: 'nav.messages' },
    { to: '/firm/profile', labelKey: 'nav.firmProfile' },
  ],
} as const satisfies Record<UserRole, readonly { to: string; labelKey: string }[]>

const STAFF_NAV = [{ to: '/staff', labelKey: 'nav.staff' }] as const

type Lock = { username: string; role: UserRole; reason: 'idle' | 'manual' }

const THEMES: Record<UserRole, string | undefined> = {
  victim: undefined,
  hr: 'hr',
  law_firm: 'firm',
}

/** Conversations with something new, beside "Messages" in the nav. */
function UnreadBadge() {
  const { t } = useTranslation()
  const { data: count } = useQuery({ queryKey: UNREAD_KEY, queryFn: unreadCount, refetchInterval: 60_000 })
  if (!count) return null
  return (
    <span className="nav-badge">
      {count}
      <span className="visually-hidden"> {t('messages.unreadCount', { count })}</span>
    </span>
  )
}

function AppLayout() {
  const { t } = useTranslation()
  const { user } = useCurrentUser()
  const { pathname } = useLocation()
  const [lock, setLock] = useState<Lock | null>(null)
  const role = user?.role ?? lock?.role
  // Partners get their own look: HR in blue, law firms in gold. Workers keep the default.
  const isStaff = Boolean(user?.is_staff)
  const theme = isStaff ? 'staff' : role ? THEMES[role] : pathname.startsWith('/partners') ? 'partner' : undefined
  const portal = isStaff ? t('nav.portal.staff') : user && user.role !== 'victim' ? t(`nav.portal.${user.role}`) : null
  // Workers, and anyone on the worker sign-in pages, can leave quickly. Partners and staff are at work.
  const showQuickExit = isStaff ? false : role ? role === 'victim' : !pathname.startsWith('/partners')
  const navItems = user ? (isStaff ? STAFF_NAV : NAV_ITEMS[user.role]) : []

  /** Hides the page and ends the session; the same account signs in again to carry on. */
  function lockNow(reason: Lock['reason']) {
    if (!user) return
    setLock({ username: user.username, role: user.role, reason })
    resetSpeaking()
    endSessionNow()
    clearSession()
  }

  function handleUnlock(unlocked: User) {
    queryClient.setQueryData(CURRENT_USER_KEY, unlocked)
    setLock(null)
  }

  const idle = useIdleLock(Boolean(user) && !lock, () => lockNow('idle'))

  async function handleSignOut() {
    try {
      await logout()
    } catch {
      // The token is already gone from this device, which is what matters here.
    }
    // A full reload wipes cached data, drafts and anything else held in memory. It also
    // stops the next person on a shared computer from landing on this person's last page.
    window.location.replace('/login')
  }

  return (
    <div className="app-shell" data-theme={theme}>
      <a className="skip-link" href="#main-content">
        {t('layout.skipToContent')}
      </a>
      <header>
        <div className="container app-header__inner">
          <Link
            className="app-brand"
            to={user ? getHome(user) : '/'}
            aria-label={t('app.home')}
          >
            <OwlMark />
            {t('app.name')}
          </Link>
          {portal && <span className="portal-badge">{portal}</span>}
          {user && (
            <nav className="app-nav" aria-label={t('layout.mainNavigation')}>
              {navItems.map(({ to, labelKey }) => (
                <NavLink key={to} to={to} end={to !== '/messages'}>
                  {t(labelKey)}
                  {to === '/messages' && <UnreadBadge />}
                </NavLink>
              ))}
            </nav>
          )}
          <div className="app-tools">
            {showQuickExit && <QuickExit />}
            <HeaderMenu user={user} onSignOut={handleSignOut} onLock={() => lockNow('manual')} />
          </div>
        </div>
      </header>
      <main id="main-content" className="container app-main" tabIndex={-1}>
        {lock ? (
          <LockScreen username={lock.username} reason={lock.reason} onUnlock={handleUnlock} />
        ) : (
          // Keyed by page, so each page fades in. Query strings, like ?session=, don't re-trigger it.
          <div key={pathname} className="page-enter">
            <Outlet />
          </div>
        )}
      </main>
      <div className="idle-warning-region" role="status">
        {idle.warning && (
          <div className="idle-warning">
            <span>{t('lock.warning')}</span>
            <button type="button" className="button button--small" onClick={idle.stayActive}>
              {t('lock.stay')}
            </button>
          </div>
        )}
      </div>
      <footer className="app-footer">
        <p className="container">{t('layout.disclaimer')}</p>
      </footer>
    </div>
  )
}

export default AppLayout
