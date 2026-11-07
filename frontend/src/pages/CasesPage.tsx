import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { listCases } from '../api/cases.ts'
import type { Case } from '../api/types.ts'
import { useCurrentUser } from '../auth/useCurrentUser.ts'
import NewCaseDialog from '../components/NewCaseDialog.tsx'
import CaseTimeline from '../components/case/CaseTimeline.tsx'
import { MiniVan } from '../components/site/WorkplaceScene.tsx'

type CaseCardProps = {
  item: Case
  dateFormat: Intl.DateTimeFormat
  isPreviewed: boolean
  onPreview: (caseId: number) => void
}

function CaseCard({ item, dateFormat, isPreviewed, onPreview }: CaseCardProps) {
  const { t } = useTranslation()

  return (
    <Link
      className="case-card"
      to={`/cases/${item.id}`}
      data-previewed={isPreviewed}
      onMouseEnter={() => onPreview(item.id)}
      onFocus={() => onPreview(item.id)}
    >
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

type CaseListProps = Omit<CaseCardProps, 'item' | 'isPreviewed'> & {
  cases: Case[]
  previewId: number | null
}

function CaseList({ cases, previewId, ...cardProps }: CaseListProps) {
  return (
    <ul className="case-list">
      {cases.map((item) => (
        <li key={item.id}>
          <CaseCard item={item} isPreviewed={item.id === previewId} {...cardProps} />
        </li>
      ))}
    </ul>
  )
}

/** The timeline of the issue last hovered or focused, shown beside the list on wide screens. */
function CaseOverview({ item }: { item: Case }) {
  const { t } = useTranslation()

  return (
    <aside className="case-overview" aria-labelledby="case-overview-heading">
      <p className="case-overview__label">{t('cases.overviewLabel')}</p>
      <h2 id="case-overview-heading">{item.title}</h2>
      {/* An overview only: past chat sessions open from the issue screen's timeline. */}
      <CaseTimeline caseId={item.id} linkSessions={false} />
      <Link className="button-quiet case-overview__open" to={`/cases/${item.id}`}>
        {t('cases.openIssue')}
      </Link>
    </aside>
  )
}

function CasesPage() {
  const { t, i18n } = useTranslation()
  const { user } = useCurrentUser()
  const [isCreating, setIsCreating] = useState(false)
  const [hoveredId, setHoveredId] = useState<number | null>(null)
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
  // Shown only while an issue is hovered or focused.
  const previewed = cases?.find((item) => item.id === hoveredId) ?? null
  const listProps = { dateFormat, previewId: previewed?.id ?? null, onPreview: setHoveredId }

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
      {cases && cases.length > 0 && (
        // Leaving the list and overview together hides the overview. Crossing the gap
        // between them doesn't, so the pointer can reach the overview's "Open issue" link.
        <div
          className="cases-layout"
          onMouseLeave={() => setHoveredId(null)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setHoveredId(null)
          }}
        >
          <div className="cases-layout__list">
            {openCases.length > 0 && (
              <section className="case-section" aria-label={t('cases.openHeading')}>
                {closedCases.length > 0 && <h2>{t('cases.openHeading')}</h2>}
                <CaseList cases={openCases} {...listProps} />
              </section>
            )}
            {closedCases.length > 0 && (
              <section className="case-section">
                <h2>{t('cases.closedHeading')}</h2>
                <CaseList cases={closedCases} {...listProps} />
              </section>
            )}
          </div>
          {previewed && <CaseOverview item={previewed} />}
        </div>
      )}
    </>
  )
}

export default CasesPage
