import { useTranslation } from 'react-i18next'
import {
  deviceReducesMotion,
  updateDisplaySettings,
  useDisplaySettings,
  type ThemeChoice,
} from '../display.ts'
import Dialog from './Dialog.tsx'

const THEME_OPTIONS = [
  { value: 'system', labelKey: 'display.themeSystem' },
  { value: 'light', labelKey: 'display.themeLight' },
  { value: 'dark', labelKey: 'display.themeDark' },
] as const satisfies readonly { value: ThemeChoice; labelKey: string }[]

function DisplayForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const settings = useDisplaySettings()
  const deviceReduces = deviceReducesMotion()

  return (
    <div className="form">
      {/* Choices apply straight away, so there's nothing to save. */}
      <fieldset className="field">
        <legend>{t('display.theme')}</legend>
        <div className="choice-list">
          {THEME_OPTIONS.map((option) => (
            <label key={option.value} className="choice">
              <input
                type="radio"
                name="display-theme"
                value={option.value}
                checked={settings.theme === option.value}
                data-autofocus={settings.theme === option.value ? '' : undefined}
                onChange={() => updateDisplaySettings({ theme: option.value })}
              />
              <span className="choice__label">{t(option.labelKey)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="field">
        <legend>{t('display.motion')}</legend>
        <label className="choice">
          <input
            type="checkbox"
            checked={settings.motion === 'reduce' || deviceReduces}
            disabled={deviceReduces}
            aria-describedby="display-motion-hint"
            onChange={(event) =>
              updateDisplaySettings({ motion: event.target.checked ? 'reduce' : 'system' })
            }
          />
          <span>
            <span className="choice__label">{t('display.reduceMotion')}</span>
            <span id="display-motion-hint" className="field-hint">
              {deviceReduces ? t('display.reduceMotionDevice') : t('display.reduceMotionHint')}
            </span>
          </span>
        </label>
      </fieldset>
      <div className="form-actions dialog__actions">
        <button type="button" className="button" onClick={onClose}>
          {t('display.done')}
        </button>
      </div>
    </div>
  )
}

/** Theme and motion settings, opened from the header menu. */
function DisplaySettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onClose={onClose} title={t('display.title')}>
      <DisplayForm onClose={onClose} />
    </Dialog>
  )
}

export default DisplaySettingsDialog
