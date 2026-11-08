import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteTimelineEntry } from '../../api/cases.ts'
import { unlinkEntry, useSessionEntries } from '../../api/sessionEntries.ts'
import type { TimelineEntry } from '../../api/types.ts'
import ConfirmDialog from '../ConfirmDialog.tsx'
import CaseTimeline from './CaseTimeline.tsx'
import TimelineEntryDialog from './TimelineEntryDialog.tsx'
import { useConversation } from './useConversation.ts'

type TimelinePanelProps = {
  caseId: number
  canEdit: boolean
  onSessionSelect?: () => void
}

/**
 * The issue's timeline. New entries come from chats (each chat session is an entry), so
 * there's no separate Add button. Entries can be renamed, redated, described or deleted.
 */
function TimelinePanel({ caseId, canEdit, onSessionSelect }: TimelinePanelProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { conversationId } = useConversation(caseId)
  const sessionEntries = useSessionEntries()
  const [editing, setEditing] = useState<TimelineEntry | null>(null)
  const [deleting, setDeleting] = useState<TimelineEntry | null>(null)
  const deletingHasChat = deleting !== null && [...sessionEntries.values()].includes(deleting.id)

  async function confirmDelete() {
    if (!deleting) return
    await deleteTimelineEntry(caseId, deleting.id)
    unlinkEntry(deleting.id)
    await queryClient.invalidateQueries({ queryKey: ['cases', caseId, 'timeline'] })
  }

  return (
    <>
      <h2>{t('case.timeline')}</h2>
      <CaseTimeline
        caseId={caseId}
        activeConversationId={conversationId}
        onSessionSelect={onSessionSelect}
        onEditEntry={canEdit ? setEditing : undefined}
        onDeleteEntry={canEdit ? setDeleting : undefined}
      />
      {canEdit && (
        <>
          <TimelineEntryDialog
            caseId={caseId}
            open={editing !== null}
            entry={editing}
            onClose={() => setEditing(null)}
          />
          <ConfirmDialog
            open={deleting !== null}
            onClose={() => setDeleting(null)}
            title={t('entry.deleteTitle')}
            message={
              deletingHasChat
                ? t('entry.deleteChatMessage', { title: deleting?.title ?? '' })
                : t('entry.deleteMessage', { title: deleting?.title ?? '' })
            }
            confirmLabel={t('entry.deleteConfirm')}
            pendingLabel={t('entry.deleting')}
            onConfirm={confirmDelete}
          />
        </>
      )}
    </>
  )
}

export default TimelinePanel
