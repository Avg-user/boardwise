import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { getCase } from '../api/cases.ts'
import { ApiError } from '../api/client.ts'
import { getRoleHome, useCurrentUser } from '../auth/useCurrentUser.ts'
import CaseHeader from '../components/case/CaseHeader.tsx'
import ChatPanel from '../components/case/ChatPanel.tsx'
import MatchesPanel from '../components/case/MatchesPanel.tsx'
import NextStepsPanel from '../components/case/NextStepsPanel.tsx'
import TimelinePanel from '../components/case/TimelinePanel.tsx'
import NotFoundPage from './NotFoundPage.tsx'

const TABS = [
  { id: 'chat', labelKey: 'case.tabs.chat' },
  { id: 'timeline', labelKey: 'case.tabs.timeline' },
  { id: 'steps', labelKey: 'case.tabs.steps' },
] as const

type TabId = (typeof TABS)[number]['id']

function CasePage() {
  const { t } = useTranslation()
  const { user } = useCurrentUser()
  const { caseId: caseIdParam } = useParams()
  const caseId = Number(caseIdParam)
  const isValidId = Number.isInteger(caseId) && caseId > 0
  const [activeTab, setActiveTab] = useState<TabId>('chat')

  const caseQuery = useQuery({
    queryKey: ['cases', caseId],
    queryFn: () => getCase(caseId),
    enabled: isValidId,
  })

  if (
    !isValidId ||
    (caseQuery.error instanceof ApiError && caseQuery.error.status === 404)
  ) {
    return <NotFoundPage />
  }
  if (caseQuery.isLoading) {
    return <p role="status">{t('common.loading')}</p>
  }
  if (!caseQuery.data) {
    return (
      <p className="form-error" role="alert">
        {t('common.serverError')}
      </p>
    )
  }

  const { title, is_owner: canEdit } = caseQuery.data

  return (
    <>
      <title>{`${title} · ${t('app.name')}`}</title>
      <Link className="back-link" to={user ? getRoleHome(user.role) : '/'}>
        {canEdit ? t('case.back') : t('case.backPartner')}
      </Link>
      <CaseHeader caseItem={caseQuery.data} />

      <div className="case-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      <div className="case-layout">
        <section className="case-pane" data-active={activeTab === 'chat'} aria-label={t('case.tabs.chat')}>
          <ChatPanel caseId={caseId} caseTitle={title} canEdit={canEdit} />
        </section>
        <div className="case-side">
          <section className="case-pane" data-active={activeTab === 'timeline'}>
            <TimelinePanel
              caseId={caseId}
              canEdit={canEdit}
              onSessionSelect={() => setActiveTab('chat')}
            />
          </section>
          <section className="case-pane" data-active={activeTab === 'steps'}>
            <NextStepsPanel caseId={caseId} canEdit={canEdit} />
          </section>
          {/* Only the owner sees who they've contacted; firms never see each other. */}
          {canEdit && (
            <section className="case-pane" data-active={activeTab === 'steps'}>
              <MatchesPanel caseId={caseId} />
            </section>
          )}
        </div>
      </div>
    </>
  )
}

export default CasePage
