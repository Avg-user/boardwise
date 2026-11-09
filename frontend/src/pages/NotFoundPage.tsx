import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { getHome, useCurrentUser } from '../auth/useCurrentUser.ts'
import { Owl } from '../components/brand/Owl.tsx'
import Icon from '../components/Icon.tsx'

/** Shown for any address the app doesn't know, and for issues, firms or threads that don't exist. */
function NotFoundPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useCurrentUser()
  const title = t('notFound.title')
  const canGoBack = window.history.length > 1

  return (
    <div className="not-found">
      <title>{`${title} · ${t('app.name')}`}</title>
      <div className="not-found__art" aria-hidden="true">
        <span className="not-found__code">4</span>
        <Owl className="owl--lost" followPointer />
        <span className="not-found__code">4</span>
      </div>
      <h1>{title}</h1>
      <p className="page-description">{t('notFound.description')}</p>
      <div className="form-actions not-found__actions">
        <Link className="button" to={user ? getHome(user) : '/login'}>
          {user ? t('notFound.home') : t('notFound.signIn')}
        </Link>
        {canGoBack && (
          <button type="button" className="button button--secondary" onClick={() => navigate(-1)}>
            <Icon name="chevronLeft" />
            {t('notFound.goBack')}
          </button>
        )}
      </div>
      <p className="not-found__help">{t('notFound.help')}</p>
    </div>
  )
}

export default NotFoundPage
