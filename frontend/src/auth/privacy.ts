// Protections for someone using Boardwise where others might see their screen: a quick exit
// that leaves the site at once, and an idle lock that hides everything until the password is
// entered again.
import { clearToken, getToken } from '../api/client.ts'
import { resetSpeaking } from '../components/case/readAloud.ts'
import { queryClient } from '../queryClient.ts'

/** Where quick exit goes: an everyday site that gives nothing away. */
export const QUICK_EXIT_URL: string =
  import.meta.env.VITE_QUICK_EXIT_URL || 'https://weather.gc.ca/'

/** Minutes without any activity before the app locks itself. */
export const IDLE_LOCK_MINUTES: number = Number(import.meta.env.VITE_IDLE_LOCK_MINUTES) || 15

/** How long before locking the warning appears. */
export const IDLE_WARNING_SECONDS = 60

/** Ends the session on the server without waiting, even while the page is being left. */
export function endSessionNow() {
  const token = getToken()
  clearToken()
  if (!token) return
  // keepalive lets the request finish after the page has gone.
  fetch('/api/auth/logout/', {
    method: 'POST',
    headers: { Authorization: `Token ${token}` },
    credentials: 'omit',
    keepalive: true,
  }).catch(() => {
    // The token is already gone from this device; the server copy is the only loss.
  })
}

/**
 * Leaves right away for a neutral site. Signs out, forgets cached case data and stops
 * reading aloud first. `replace` swaps this page out of the history, so Back doesn't return
 * to it (earlier pages stay in the history, but they need a sign-in now).
 */
export function quickExit() {
  resetSpeaking()
  endSessionNow()
  queryClient.clear()
  window.location.replace(QUICK_EXIT_URL)
}
