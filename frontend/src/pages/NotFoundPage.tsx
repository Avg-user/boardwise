import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

function NotFoundPage() {
  const { t } = useTranslation()
  const title = t('notFound.title')

  return (
    <>
      <title>{`${title} · ${t('app.name')}`}</title>
      <h1>{title}</h1>
      <p className="page-description">{t('notFound.description')}</p>
      <Link className="button" to="/">
        {t('notFound.back')}
      </Link>
    </>
  )
}

export default NotFoundPage
