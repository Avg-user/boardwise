import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { quickExit } from '../auth/privacy.ts'
import Icon from './Icon.tsx'

/** Two presses of Escape this close together leave the site. One press still closes menus. */
const DOUBLE_PRESS_MS = 800

/** Leaves the site at once, by button or by pressing Escape twice. */
function QuickExit() {
  const { t } = useTranslation()

  useEffect(() => {
    let lastEscape = 0
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat) return
      const now = Date.now()
      if (now - lastEscape < DOUBLE_PRESS_MS) quickExit()
      lastEscape = now
    }
    // Capture phase, so a menu or dialog that handles Escape itself can't hide it from us.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  return (
    <button
      type="button"
      className="quick-exit"
      onClick={quickExit}
      title={t('quickExit.hint')}
      aria-label={`${t('quickExit.label')}. ${t('quickExit.hint')}`}
    >
      <Icon name="exit" />
      <span>{t('quickExit.label')}</span>
    </button>
  )
}

export default QuickExit
