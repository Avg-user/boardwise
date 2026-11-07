import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { listCases } from '../api/cases.ts'
import type { Case } from '../api/types.ts'
import { useCurrentUser } from '../auth/useCurrentUser.ts'
import NewCaseDialog from '../components/NewCaseDialog.tsx'
import { MiniVan } from '../components/site/WorkplaceScene.tsx'

function CaseCard({ item, dateFormat }: { item: Case; dateFormat: Intl.DateTimeFormat }) {
  const { t } = useTranslation()

  return (
    <Link className="case-card" to={`/cases/${item.id}`}>
      <span className="case-card__text">
        <span className="case-card__title">{item.title}</span>
        <span className="case-card__meta">
          {t('cases.updated', { date: dateFormat.format(new Date(item.updated_at)) })}
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
  )
}

function CaseList({ cases, dateFormat }: { cases: Case[]; dateFormat: Intl.DateTimeFormat }) {
  return (
    <ul className="case-list">
      {cases.map((item) => (
        <li key={item.id}>
          <CaseCard item={item} dateFormat={dateFormat} />
        </li>
      ))}
    </ul>
  )
}

function CasesPage() {
  const { t, i18n } = useTranslation()
  const { user } = useCurrentUser()
  const [isCreating, setIsCreating] = useState(false)
  const { data: cases, isLoading, isError } = useQuery({
    queryKey: ['cases'],
    queryFn: listCases,
  })
  const title = t('cases.title')
  const dateFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  const canCreate = user?.role === 'victim'
  const openCases = cases?.filter((item) => item.status === 'open') ?? []
  const closedCases = cases?.filter((item) => item.status === 'closed') ?? []

  return (
    <>
      <title>{`${title} · ${t('app.name')}`}</title>
      <p className="eyebrow">{t('cases.eyebrow')}</p>
      <div className="page-header">
        <h1>{title}</h1>
        {canCreate && (
          <button type="button" className="button" onClick={() => setIsCreating(true)}>
            {t('cases.newIssue')}
          </button>
        )}
      </div>
      {canCreate && <NewCaseDialog open={isCreating} onClose={() => setIsCreating(false)} />}
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
          <p className="placeholder-notice">
            {t('cases.empty')}{' '}
            {canCreate && (
              <button type="button" className="link-button" onClick={() => setIsCreating(true)}>
                {t('cases.emptyCta')}
              </button>
            )}
          </p>
        </div>
      )}
      {openCases.length > 0 && (
        <section className="case-section" aria-label={t('cases.openHeading')}>
          {closedCases.length > 0 && <h2>{t('cases.openHeading')}</h2>}
          <CaseList cases={openCases} dateFormat={dateFormat} />
        </section>
      )}
      {closedCases.length > 0 && (
        <section className="case-section">
          <h2>{t('cases.closedHeading')}</h2>
          <CaseList cases={closedCases} dateFormat={dateFormat} />
        </section>
      )}
    </>
  )
}

export default CasesPage
