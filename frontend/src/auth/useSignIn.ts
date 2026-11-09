import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { login } from '../api/auth.ts'
import { ApiError } from '../api/client.ts'
import { CURRENT_USER_KEY, queryClient } from '../queryClient.ts'
import { getHome } from './useCurrentUser.ts'

/** Shared by the worker and partner sign-in pages. The account's role decides where it lands. */
export function useSignIn() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const signedIn = await login(username.trim(), password)
      queryClient.setQueryData(CURRENT_USER_KEY, signedIn)
      const from: unknown = location.state?.from
      navigate(typeof from === 'string' ? from : getHome(signedIn), { replace: true })
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 400
          ? t('auth.invalidCredentials')
          : t('common.serverError'),
      )
      setIsSubmitting(false)
    }
  }

  return { username, setUsername, password, setPassword, error, isSubmitting, handleSubmit }
}
