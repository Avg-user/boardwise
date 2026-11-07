import { useTranslation } from 'react-i18next'

type PlaceholderPageProps = {
  name: 'lawyers' | 'hr' | 'firm'
}

// Stands in for each screen until the real page replaces it in App.tsx.
function PlaceholderPage({ name }: PlaceholderPageProps) {
  const { t } = useTranslation()
  const title = t(`pages.${name}.title`)

  return (
    <>
      <title>{`${title} · ${t('app.name')}`}</title>
      <h1>{title}</h1>
      <p className="page-description">{t(`pages.${name}.description`)}</p>
      <p className="placeholder-notice">{t('placeholder.notice')}</p>
    </>
  )
}

export default PlaceholderPage
