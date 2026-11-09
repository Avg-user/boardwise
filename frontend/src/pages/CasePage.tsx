import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { getCase } from '../api/cases.ts'
import { ApiError } from '../api/client.ts'
import { getHome, useCurrentUser } from '../auth/useCurrentUser.ts'
import CaseHeader from '../components/case/CaseHeader.tsx'
import ChatPanel from '../components/case/ChatPanel.tsx'
import MatchesPanel from '../components/case/MatchesPanel.tsx'
import NextStepsPanel from '../components/case/NextStepsPanel.tsx'
import TimelinePanel from '../components/case/TimelinePanel.tsx'
import Icon from '../components/Icon.tsx'
import NotFoundPage from './NotFoundPage.tsx'

const TABS = [
  { id: 'chat', labelKey: 'case.tabs.chat' },
  { id: 'timeline', labelKey: 'case.tabs.timeline' },
  { id: 'steps', labelKey: 'case.tabs.steps' },
] as const

type TabId = (typeof TABS)[number]['id']

// Wide screens show the chat beside one of these at a time, in a column as tall as the chat.
const SIDE_TABS = [
  { id: 'timeline', labelKey: 'case.tabs.timeline' },
  { id: 'steps', labelKey: 'case.tabs.steps' },
  { id: 'lawyers', labelKey: 'case.tabs.lawyers' },
] as const

type SideTabId = (typeof SIDE_TABS)[number]['id']

function CasePage() {
  const { t } = useTranslation()
  const { user } = useCurrentUser()
  const { caseId: caseIdParam } = useParams()
  const caseId = Number(caseIdParam)
  const isValidId = Number.isInteger(caseId) && caseId > 0
  const [activeTab, setActiveTab] = useState<TabId>('chat')
  const [sideTab, setSideTab] = useState<SideTabId>('timeline')

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
      {/* On wide screens the back link sits beside the title as an icon, which leaves room
          for the whole chat card on screen. Its label stays for screen readers and on hover. */}
      <div className="case-top">
        <Link
          className="back-link"
          to={user ? getHome(user) : '/'}
          title={canEdit ? t('case.back') : t('case.backPartner')}
        >
          <Icon name="chevronLeft" />
          <span className="back-link__label">{canEdit ? t('case.back') : t('case.backPartner')}</span>
        </Link>
        <CaseHeader caseItem={caseQuery.data} />
      </div>

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
          {/* data-active is the phone tab, data-side the wide-screen one. */}
          <div className="side-tabs">
            {SIDE_TABS.filter((tab) => canEdit || tab.id !== 'lawyers').map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-pressed={sideTab === tab.id}
                onClick={() => setSideTab(tab.id)}
              >
                {t(tab.labelKey)}
              </button>
            ))}
          </div>
          <div className="case-side__panes">
            <section className="case-pane panel" data-active={activeTab === 'timeline'} data-side={sideTab === 'timeline'}>
              <TimelinePanel
                caseId={caseId}
                canEdit={canEdit}
                onSessionSelect={() => setActiveTab('chat')}
              />
            </section>
            <section className="case-pane panel" data-active={activeTab === 'steps'} data-side={sideTab === 'steps'}>
              <NextStepsPanel caseId={caseId} canEdit={canEdit} />
            </section>
            {/* Only the owner sees who they've contacted; firms never see each other. */}
            {canEdit && (
              <section className="case-pane panel" data-active={activeTab === 'steps'} data-side={sideTab === 'lawyers'}>
                <MatchesPanel caseId={caseId} />
              </section>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

export default CasePage
