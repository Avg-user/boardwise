import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { listCases } from '../api/cases.ts'
import type { Case } from '../api/types.ts'
import { useCurrentUser } from '../auth/useCurrentUser.ts'
import NewCaseDialog from '../components/NewCaseDialog.tsx'
import CaseTimeline from '../components/case/CaseTimeline.tsx'
import { Owl } from '../components/brand/Owl.tsx'
import Icon from '../components/Icon.tsx'

type CaseCardProps = {
  item: Case
  dateFormat: Intl.DateTimeFormat
  isPreviewed: boolean
  onPreview: (caseId: number) => void
}

function CaseCard({ item, dateFormat, isPreviewed, onPreview }: CaseCardProps) {
  const { t } = useTranslation()
  const entries = item.timeline_count ?? 0
  const total = item.tasks_total ?? 0
  const done = item.tasks_done ?? 0
  const shared = item.shared_count ?? 0

  return (
    <Link
      className="case-card"
      to={`/cases/${item.id}`}
      data-previewed={isPreviewed}
      data-status={item.status}
      onMouseEnter={() => onPreview(item.id)}
      onFocus={() => onPreview(item.id)}
    >
      <span className="case-card__title">{item.title}</span>
      <span className="case-card__meta">
        <span>
          {t('cases.updated')}{' '}
          <time dateTime={item.updated_at}>{dateFormat.format(new Date(item.updated_at))}</time>
        </span>
        {entries > 0 && <span>{t('cases.meta.entries', { count: entries })}</span>}
        {total > 0 && <span>{t('cases.meta.steps', { done, total })}</span>}
        {shared > 0 && <span className="case-card__shared">{t('cases.meta.shared', { count: shared })}</span>}
      </span>
      {total > 0 && (
        <span className="case-card__progress" aria-hidden="true">
          <span style={{ width: `${(done / total) * 100}%` }} />
        </span>
      )}
      <Icon name="chevronRight" className="case-card__arrow" />
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

/** Shown beside the list when no issue is being previewed. */
function HelpPanel() {
  const { t } = useTranslation()
  return (
    <aside className="help-panel" aria-label={t('cases.help.label')}>
      <section className="help-panel__section help-panel__section--urgent">
        <h2>{t('cases.help.urgentTitle')}</h2>
        <ul className="help-links">
          <li>
            {t('cases.help.danger')} <a href="tel:911">{t('cases.help.call911')}</a>
          </li>
          <li>
            {t('cases.help.support')} <a href="tel:988">{t('cases.help.call988')}</a>
          </li>
        </ul>
      </section>
      <section className="help-panel__section">
        <h2>{t('cases.help.lawyerTitle')}</h2>
        <p>{t('cases.help.lawyerText')}</p>
        <Link className="arrow-link" to="/lawyers">
          {t('cases.help.lawyerLink')}
          <Icon name="chevronRight" />
        </Link>
      </section>
      <section className="help-panel__section">
        <h2>{t('cases.help.privacyTitle')}</h2>
        <p>{t('cases.help.privacyText')}</p>
      </section>
    </aside>
  )
}

function OwlGreeting({ name }: { name?: string }) {
  const { t } = useTranslation()
  return (
    <div className="owl-greeting">
      <p className="owl-greeting__bubble">
        <strong>{name ? t('cases.greeting.hello', { name }) : t('cases.greeting.helloNoName')}</strong>
        {t('cases.greeting.text')}
      </p>
      <Owl className="owl--greeting" followPointer />
    </div>
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
      <div className="page-header">
        <div>
          <h1>{title}</h1>
          <p className="page-description">{t('cases.description')}</p>
        </div>
        {canCreate && (
          <button type="button" className="button" onClick={() => setIsCreating(true)}>
            <Icon name="plus" />
            {t('cases.newIssue')}
          </button>
        )}
      </div>
      {canCreate && <NewCaseDialog open={isCreating} onClose={() => setIsCreating(false)} />}
      {isLoading && <p role="status">{t('common.loading')}</p>}
      {isError && (
        <p className="form-error" role="alert">
          {t('common.serverError')}
        </p>
      )}
      {cases?.length === 0 && (
        <div className="empty-state">
          <Owl className="owl--empty" />
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
          <div className="cases-side">
            <OwlGreeting name={user?.username} />
            {/* Keyed by issue, so each preview fades in fresh. */}
            {previewed ? <CaseOverview key={previewed.id} item={previewed} /> : <HelpPanel />}
          </div>
        </div>
      )}
    </>
  )
}

export default CasesPage
