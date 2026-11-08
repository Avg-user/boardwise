import { useCallback, useEffect, useRef, useState } from 'react'
import { IDLE_LOCK_MINUTES, IDLE_WARNING_SECONDS } from './privacy.ts'

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const
const CHECK_EVERY_MS = 5_000

/**
 * Calls `onLock` after IDLE_LOCK_MINUTES without any pointer, key or scroll activity, and
 * reports `warning` for the last minute before that. Time is measured from the clock, not
 * from timers, because browsers slow timers down in background tabs: coming back to a tab
 * that has been idle long enough locks it at once.
 */
export function useIdleLock(enabled: boolean, onLock: () => void) {
  const [warning, setWarning] = useState(false)
  const lastActivity = useRef(0)
  const onLockRef = useRef(onLock)
  useEffect(() => {
    onLockRef.current = onLock
  })

  const stayActive = useCallback(() => {
    lastActivity.current = Date.now()
    setWarning(false)
  }, [])

  useEffect(() => {
    if (!enabled) return
    const lockAfter = IDLE_LOCK_MINUTES * 60_000
    // Short timeouts (for trying it out) warn for the second half instead.
    const warnAfter = lockAfter - Math.min(IDLE_WARNING_SECONDS * 1000, lockAfter / 2)
    lastActivity.current = Date.now()

    const check = () => {
      const idle = Date.now() - lastActivity.current
      if (idle >= lockAfter) {
        setWarning(false)
        onLockRef.current()
      } else {
        setWarning(idle >= warnAfter)
      }
    }
    // Activity only moves the clock; the warning goes away on the next check, or at once
    // through stayActive when its button is pressed.
    const onActivity = () => {
      lastActivity.current = Date.now()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }

    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, onActivity, { passive: true }))
    document.addEventListener('visibilitychange', onVisible)
    const interval = window.setInterval(check, Math.min(CHECK_EVERY_MS, lockAfter / 12))
    return () => {
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, onActivity))
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(interval)
      setWarning(false)
    }
  }, [enabled])

  return { warning, stayActive }
}
