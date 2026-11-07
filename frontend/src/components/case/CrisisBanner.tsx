import { useTranslation } from 'react-i18next'

// Numbers checked against Government of Alberta, 211 Alberta and 988.ca on 2026-11-07.
const RESOURCES = [
  { labelKey: 'crisis.suicideLine', display: '988', tel: '988' },
  { labelKey: 'crisis.mentalHealthLine', display: '1-877-303-2642', tel: '18773032642' },
  { labelKey: 'crisis.familyViolenceLine', display: '310-1818', tel: '3101818' },
  { labelKey: 'crisis.supportLine', display: '211', tel: '211' },
] as const

function CrisisBanner({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation()

  return (
    <div className="crisis-banner" role="alert">
      <h2>{t('crisis.title')}</h2>
      <p>
        <a className="crisis-banner__primary" href="tel:911">
          {t('crisis.call911')}
        </a>
      </p>
      <p>{t('crisis.supportIntro')}</p>
      <ul>
        {RESOURCES.map((resource) => (
          <li key={resource.tel}>
            {t(resource.labelKey)}: <a href={`tel:${resource.tel}`}>{resource.display}</a>
          </li>
        ))}
      </ul>
      <p>{t('crisis.notSent')}</p>
      <button type="button" className="button-quiet" onClick={onDismiss}>
        {t('crisis.hide')}
      </button>
    </div>
  )
}

export default CrisisBanner
