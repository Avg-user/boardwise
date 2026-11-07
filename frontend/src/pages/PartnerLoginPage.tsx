import { useTranslation } from 'react-i18next'
import { Link, Navigate } from 'react-router-dom'
import { getRoleHome, useCurrentUser } from '../auth/useCurrentUser.ts'
import { useSignIn } from '../auth/useSignIn.ts'
import { BuildingIcon, ScalesIcon } from '../components/partners/PartnerIcons.tsx'

const AUDIENCES = [
  { key: 'hr', Icon: BuildingIcon, points: ['hrPoint1', 'hrPoint2', 'hrPoint3'] },
  { key: 'firm', Icon: ScalesIcon, points: ['firmPoint1', 'firmPoint2', 'firmPoint3'] },
] as const

function PartnerLoginPage() {
  const { t } = useTranslation()
  const { user } = useCurrentUser()
  const form = useSignIn()

  if (user && !form.isSubmitting) {
    return <Navigate to={getRoleHome(user.role)} replace />
  }

  const title = t('partners.signIn')

  return (
    <div className="auth-split auth-split--partner">
      <div className="auth-page">
        <title>{`${title} · ${t('app.name')}`}</title>
        <p className="eyebrow">{t('partners.eyebrow')}</p>
        <h1>{title}</h1>
        <p className="page-description">{t('partners.description')}</p>
        <form className="form" onSubmit={form.handleSubmit}>
          <div className="field">
            <label htmlFor="partner-username">{t('auth.username')}</label>
            <input
              id="partner-username"
              autoComplete="username"
              autoCapitalize="none"
              required
              value={form.username}
              onChange={(event) => form.setUsername(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="partner-password">{t('auth.password')}</label>
            <input
              id="partner-password"
              type="password"
              autoComplete="current-password"
              required
              value={form.password}
              onChange={(event) => form.setPassword(event.target.value)}
            />
          </div>
          {form.error && (
            <p className="form-error" role="alert">
              {form.error}
            </p>
          )}
          <button className="button" type="submit" disabled={form.isSubmitting}>
            {form.isSubmitting ? t('auth.signingIn') : t('auth.signIn')}
          </button>
        </form>
        <p className="auth-switch">
          {t('partners.notPartner')} <Link to="/login">{t('partners.workerSignIn')}</Link>
        </p>
      </div>

      <section className="partner-panel" aria-labelledby="partner-panel-title">
        <h2 id="partner-panel-title" className="partner-panel__title">
          {t('partners.panelTitle')}
        </h2>
        <div className="partner-cards">
          {AUDIENCES.map(({ key, Icon, points }) => (
            <article key={key} className="partner-card">
              <Icon />
              <h3>{t(`partners.${key}Title`)}</h3>
              <ul>
                {points.map((point) => (
                  <li key={point}>{t(`partners.${point}`)}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
        <p className="partner-panel__note">{t('partners.control')}</p>
      </section>
    </div>
  )
}

export default PartnerLoginPage
