import { useTranslation } from 'react-i18next'
import CaseTimeline from './CaseTimeline.tsx'
import { useConversation } from './useConversation.ts'

type TimelinePanelProps = {
  caseId: number
  onSessionSelect?: () => void
}

function TimelinePanel({ caseId, onSessionSelect }: TimelinePanelProps) {
  const { t } = useTranslation()
  const { conversationId } = useConversation(caseId)

  return (
    <>
      <h2>{t('case.timeline')}</h2>
      <CaseTimeline
        caseId={caseId}
        activeConversationId={conversationId}
        onSessionSelect={onSessionSelect}
      />
    </>
  )
}

export default TimelinePanel
