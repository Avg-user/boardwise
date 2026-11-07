import { useTranslation } from 'react-i18next'
import { LANGUAGES, setLanguage } from '../i18n'

function LanguageSwitcher() {
  const { t, i18n } = useTranslation()

  return (
    <label className="language-switcher">
      <span>{t('layout.language')}</span>
      <select
        value={i18n.resolvedLanguage}
        onChange={(event) => setLanguage(event.target.value)}
      >
        {LANGUAGES.map(({ code, label }) => (
          <option key={code} value={code} lang={code}>
            {label}
          </option>
        ))}
      </select>
    </label>
  )
}

export default LanguageSwitcher
