import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { login } from '../api/auth.ts'
import { ApiError } from '../api/client.ts'
import { getRoleHome, useCurrentUser } from '../auth/useCurrentUser.ts'
import { CURRENT_USER_KEY, queryClient } from '../queryClient.ts'

function LoginPage() {
  const { t } = useTranslation()
  const { user } = useCurrentUser()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (user && !isSubmitting) {
    return <Navigate to={getRoleHome(user.role)} replace />
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const signedIn = await login(username.trim(), password)
      queryClient.setQueryData(CURRENT_USER_KEY, signedIn)
      const from: unknown = location.state?.from
      navigate(typeof from === 'string' ? from : getRoleHome(signedIn.role), { replace: true })
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 400
          ? t('auth.invalidCredentials')
          : t('common.serverError'),
      )
      setIsSubmitting(false)
    }
  }

  const title = t('auth.signIn')

  return (
    <div className="auth-page">
      <title>{`${title} · ${t('app.name')}`}</title>
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
    </div>
  )
}

export default LoginPage
