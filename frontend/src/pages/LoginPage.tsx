import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate } from 'react-router-dom'
import { getHome, useCurrentUser } from '../auth/useCurrentUser.ts'
import { useSignIn } from '../auth/useSignIn.ts'
import { Owl } from '../components/brand/Owl.tsx'
import WorkplaceScene from '../components/site/WorkplaceScene.tsx'

function LoginPage() {
  const { t } = useTranslation()
  const { user } = useCurrentUser()
  const { username, setUsername, password, setPassword, error, isSubmitting, handleSubmit } =
    useSignIn()
  // The owl covers its eyes while the password field has focus.
  const [typingPassword, setTypingPassword] = useState(false)

  if (user && !isSubmitting) {
    return <Navigate to={getHome(user)} replace />
  }

  const title = t('auth.signIn')

  return (
    <div className="auth-split">
      <div className="auth-page auth-page--perch">
        <Owl className="owl--perch" wave followPointer coverEyes={typingPassword} />
        <title>{`${title} · ${t('app.name')}`}</title>
        <p className="eyebrow">{t('auth.eyebrow')}</p>
        <h1>{title}</h1>
        <p className="page-description">{t('auth.signInDescription')}</p>
        <form className="form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="login-username">{t('auth.username')}</label>
            <input
              id="login-username"
              autoComplete="username"
              autoCapitalize="none"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="login-password">{t('auth.password')}</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onFocus={() => setTypingPassword(true)}
              onBlur={() => setTypingPassword(false)}
            />
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? t('auth.signingIn') : t('auth.signIn')}
          </button>
        </form>
        <p className="auth-switch">
          {t('auth.noAccount')} <Link to="/signup">{t('auth.createAccount')}</Link>
        </p>
        <p className="partner-link">
          {t('partners.prompt')} <Link to="/partners/login">{t('partners.link')}</Link>
        </p>
      </div>
      <div className="scene-panel">
        <p className="scene-panel__tagline">
          {t('auth.taglineStart')} <em>{t('auth.taglineEmphasis')}</em>
        </p>
        <WorkplaceScene />
        <p className="scene-panel__note">{t('auth.taglineNote')}</p>
      </div>
    </div>
  )
}

export default LoginPage
