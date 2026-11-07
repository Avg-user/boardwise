import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { signup } from '../api/auth.ts'
import { ApiError } from '../api/client.ts'
import type { UserRole } from '../api/types.ts'
import { getRoleHome, useCurrentUser } from '../auth/useCurrentUser.ts'
import { CURRENT_USER_KEY, queryClient } from '../queryClient.ts'

const MIN_PASSWORD_LENGTH = 8

const ROLE_OPTIONS = [
  { value: 'victim', labelKey: 'auth.roles.victim', hintKey: 'auth.roles.victimHint' },
  { value: 'hr', labelKey: 'auth.roles.hr', hintKey: 'auth.roles.hrHint' },
  { value: 'law_firm', labelKey: 'auth.roles.lawFirm', hintKey: 'auth.roles.lawFirmHint' },
] as const satisfies readonly { value: UserRole; labelKey: string; hintKey: string }[]

type FieldErrors = { username?: string; password?: string; confirm?: string; form?: string }

function firstMessage(value: unknown): string | undefined {
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined
}

function SignupPage() {
  const { t, i18n } = useTranslation()
  const { user } = useCurrentUser()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [role, setRole] = useState<UserRole>('victim')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (user && !isSubmitting) {
    return <Navigate to={getRoleHome(user.role)} replace />
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const found: FieldErrors = {}
    if (!username.trim()) {
      found.username = t('auth.usernameRequired')
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      found.password = t('auth.passwordTooShort', { count: MIN_PASSWORD_LENGTH })
    }
    if (password !== confirm) {
      found.confirm = t('auth.passwordMismatch')
    }
    setErrors(found)
    if (Object.keys(found).length > 0) {
      return
    }

    setIsSubmitting(true)
    try {
      const created = await signup({
        username: username.trim(),
        password,
        role,
        preferred_language: i18n.resolvedLanguage ?? 'en',
      })
      queryClient.setQueryData(CURRENT_USER_KEY, created)
      navigate(getRoleHome(created.role), { replace: true })
    } catch (caught) {
      setIsSubmitting(false)
      if (caught instanceof ApiError && (caught.status === 404 || caught.status === 405)) {
        setErrors({ form: t('auth.signupUnavailable') })
      } else if (caught instanceof ApiError && caught.status === 400) {
        const data = (caught.data ?? {}) as Record<string, unknown>
        const fields = {
          username: firstMessage(data.username),
          password: firstMessage(data.password),
        }
        setErrors({
          ...fields,
          form: fields.username || fields.password ? undefined : t('common.serverError'),
        })
      } else {
        setErrors({ form: t('common.serverError') })
      }
    }
  }

  const title = t('auth.createAccount')

  return (
    <div className="auth-page">
      <title>{`${title} · ${t('app.name')}`}</title>
      <h1>{title}</h1>
      <p className="page-description">{t('auth.signUpDescription')}</p>
      <form className="form" onSubmit={handleSubmit} noValidate>
        <fieldset className="field">
          <legend>{t('auth.roleQuestion')}</legend>
          <div className="choice-list">
            {ROLE_OPTIONS.map((option) => (
              <label key={option.value} className="choice">
                <input
                  type="radio"
                  name="role"
                  value={option.value}
                  checked={role === option.value}
                  onChange={() => setRole(option.value)}
                />
                <span>
                  <span className="choice__label">{t(option.labelKey)}</span>
                  <span className="field-hint">{t(option.hintKey)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="signup-username">{t('auth.username')}</label>
          <input
            id="signup-username"
            autoComplete="username"
            autoCapitalize="none"
            required
            aria-describedby="signup-username-hint"
            aria-invalid={Boolean(errors.username)}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <span id="signup-username-hint" className="field-hint">
            {t('auth.usernameHint')}
          </span>
          {errors.username && (
            <span className="form-error" role="alert">
              {errors.username}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="signup-password">{t('auth.password')}</label>
          <input
            id="signup-password"
            type="password"
            autoComplete="new-password"
            required
            aria-invalid={Boolean(errors.password)}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {errors.password && (
            <span className="form-error" role="alert">
              {errors.password}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="signup-confirm">{t('auth.confirmPassword')}</label>
          <input
            id="signup-confirm"
            type="password"
            autoComplete="new-password"
            required
            aria-invalid={Boolean(errors.confirm)}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
          {errors.confirm && (
            <span className="form-error" role="alert">
              {errors.confirm}
            </span>
          )}
        </div>
        {errors.form && (
          <p className="form-error" role="alert">
            {errors.form}
          </p>
        )}
        <button className="button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('auth.creatingAccount') : t('auth.createAccount')}
        </button>
      </form>
      <p className="auth-switch">
        {t('auth.haveAccount')} <Link to="/login">{t('auth.signIn')}</Link>
      </p>
    </div>
  )
}

export default SignupPage
