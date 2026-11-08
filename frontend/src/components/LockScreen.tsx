import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { login } from '../api/auth.ts'
import { ApiError } from '../api/client.ts'
import type { User } from '../api/types.ts'
import { IDLE_LOCK_MINUTES } from '../auth/privacy.ts'
import { Owl } from './brand/Owl.tsx'

type LockScreenProps = {
  username: string
  /** Why it locked: after inactivity, or because the person chose to. */
  reason: 'idle' | 'manual'
  onUnlock: (user: User) => void
}

/**
 * Shown in place of the page while the app is locked. The page itself is unmounted and its
 * cached data dropped, and the session token was deleted, so nothing is left on screen or
 * in memory. Unlocking is a fresh sign-in as the same account.
 */
function LockScreen({ username, reason, onUnlock }: LockScreenProps) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      onUnlock(await login(username, password))
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 400
          ? t('lock.wrongPassword')
          : t('common.serverError'),
      )
      setPassword('')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="lock-screen">
      <title>{`${t('lock.title')} · ${t('app.name')}`}</title>
      <div className="auth-page lock-screen__card">
        <Owl className="lock-screen__owl" coverEyes />
        <h1>{t('lock.title')}</h1>
        <p className="page-description">
          {reason === 'idle' ? t('lock.idle', { count: IDLE_LOCK_MINUTES }) : t('lock.manual')}
        </p>
        <form className="form" onSubmit={handleSubmit}>
          {/* Lets password managers fill the right account. */}
          <input type="hidden" name="username" autoComplete="username" value={username} />
          <div className="field">
            <label htmlFor="unlock-password">
              {t('lock.passwordFor', { name: username })}
            </label>
            <input
              id="unlock-password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
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
            {isSubmitting ? t('lock.unlocking') : t('lock.unlock')}
          </button>
        </form>
        <p className="auth-switch">
          {/* The session is already over, so this is just a trip to the sign-in page. */}
          <a href="/login">{t('lock.someoneElse')}</a>
        </p>
      </div>
    </div>
  )
}

export default LockScreen
