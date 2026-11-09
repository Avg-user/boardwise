import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router-dom'
import { getHome, useCurrentUser } from '../auth/useCurrentUser.ts'
import CasesPage from './CasesPage.tsx'
import LandingPage from './LandingPage.tsx'

/**
 * "/": the landing page for visitors, My Issues for workers, and everyone else's own home.
 * This only shapes the UI; the API enforces access on its own.
 */
function HomeRoute() {
  const { t } = useTranslation()
  const { user, isLoading } = useCurrentUser()

  if (isLoading) {
    return <p role="status">{t('common.loading')}</p>
  }
  if (!user) {
    return <LandingPage />
  }
  if (user.is_staff || user.role !== 'victim') {
    return <Navigate to={getHome(user)} replace />
  }
  return <CasesPage />
}

export default HomeRoute
