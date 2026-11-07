import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { logout } from '../api/auth.ts'
import type { UserRole } from '../api/types.ts'
import { getRoleHome, useCurrentUser } from '../auth/useCurrentUser.ts'
import LanguageSwitcher from './LanguageSwitcher.tsx'
import { SafetyMark } from './site/WorkplaceScene.tsx'

const NAV_ITEMS = {
  victim: [
    { to: '/', labelKey: 'nav.issues' },
    { to: '/lawyers', labelKey: 'nav.lawyers' },
  ],
  hr: [{ to: '/hr', labelKey: 'nav.hr' }],
  law_firm: [{ to: '/firm', labelKey: 'nav.firm' }],
} as const satisfies Record<UserRole, readonly { to: string; labelKey: string }[]>

function AppLayout() {
  const { t } = useTranslation()
  const { user } = useCurrentUser()

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
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {t('layout.skipToContent')}
      </a>
      <header>
        <div className="container app-header__inner">
          <Link
            className="app-brand"
            to={user ? getRoleHome(user.role) : '/login'}
            aria-label={t('app.home')}
          >
            <SafetyMark />
            {t('app.name')}
          </Link>
          {user && (
            <nav className="app-nav" aria-label={t('layout.mainNavigation')}>
              {NAV_ITEMS[user.role].map(({ to, labelKey }) => (
                <NavLink key={to} to={to} end>
                  {t(labelKey)}
                </NavLink>
              ))}
            </nav>
          )}
          <div className="app-tools">
            <LanguageSwitcher />
            {user && (
              <>
                <span className="app-username">{user.username}</span>
                <button type="button" className="button-quiet" onClick={handleSignOut}>
                  {t('auth.signOut')}
                </button>
              </>
            )}
          </div>
        </div>
      </header>
      <main id="main-content" className="container app-main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="app-footer">
        <p className="container">{t('layout.disclaimer')}</p>
      </footer>
    </div>
  )
}

export default AppLayout
