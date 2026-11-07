import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import fr from './locales/fr.json'

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
] as const

const STORAGE_KEY = 'boardwise.language'

function readStoredLanguage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function setLanguage(code: string) {
  void i18n.changeLanguage(code)
  try {
    localStorage.setItem(STORAGE_KEY, code)
  } catch {
    // The choice still applies for this visit if storage is unavailable.
  }
}

// Keeps screen readers and browser translation in step with the visible language.
i18n.on('languageChanged', (code) => {
  document.documentElement.lang = code
})

void i18n.use(initReactI18next).init({
  // `satisfies` makes the build fail when a French string is missing.
  resources: {
    en: { translation: en },
    fr: { translation: fr satisfies typeof en },
  },
  lng: readStoredLanguage() ?? navigator.language.split('-')[0],
  fallbackLng: 'en',
  supportedLngs: LANGUAGES.map((language) => language.code),
  interpolation: { escapeValue: false },
})

export default i18n
