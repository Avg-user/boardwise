import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { listCases } from '../api/cases.ts'
import { MiniVan } from '../components/site/WorkplaceScene.tsx'

// A simple list so the issue screen is reachable. Step 4 builds this out.
function CasesPage() {
  const { t, i18n } = useTranslation()
  const { data: cases, isLoading, isError } = useQuery({
    queryKey: ['cases'],
    queryFn: listCases,
  })
  const title = t('cases.title')
  const dateFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return (
    <>
      <title>{`${title} · ${t('app.name')}`}</title>
      <p className="eyebrow">{t('cases.eyebrow')}</p>
      <h1>{title}</h1>
      <p className="page-description">{t('cases.description')}</p>
      {isLoading && <p role="status">{t('common.loading')}</p>}
      {isError && (
        <p className="form-error" role="alert">
          {t('common.serverError')}
        </p>
      )}
      {cases?.length === 0 && (
        <div className="empty-state">
          <MiniVan />
          <p className="placeholder-notice">{t('cases.empty')}</p>
        </div>
      )}
      {cases && cases.length > 0 && (
        <ul className="case-list">
          {cases.map((item) => (
            <li key={item.id}>
              <Link className="case-card" to={`/cases/${item.id}`}>
                <span className="case-card__text">
                  <span className="case-card__title">{item.title}</span>
                  <span className="case-card__meta">
                    {t('cases.updated', { date: dateFormat.format(new Date(item.updated_at)) })}
                    {item.status === 'closed' && ` · ${t('cases.closed')}`}
                  </span>
                </span>
                <svg
                  className="case-card__arrow"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

export default CasesPage
