import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet } from 'react-router-dom'
import LanguageSwitcher from './LanguageSwitcher.tsx'

function AppLayout() {
  const { t } = useTranslation()

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {t('layout.skipToContent')}
      </a>
      <header className="app-header">
        <div className="container app-header__inner">
          <Link className="app-brand" to="/" aria-label={t('app.home')}>
            {t('app.name')}
          </Link>
          <nav className="app-nav" aria-label={t('layout.mainNavigation')}>
            <NavLink to="/" end>
              {t('nav.issues')}
            </NavLink>
            <NavLink to="/lawyers">{t('nav.lawyers')}</NavLink>
          </nav>
          <LanguageSwitcher />
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
