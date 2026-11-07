import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useCurrentUser } from './useCurrentUser.ts'

function RequireAuth() {
  const { t } = useTranslation()
  const { user, isLoading } = useCurrentUser()
  const location = useLocation()

  if (isLoading) {
    return <p role="status">{t('common.loading')}</p>
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}

export default RequireAuth
