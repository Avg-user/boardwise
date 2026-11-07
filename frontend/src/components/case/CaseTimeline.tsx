import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { listTimeline } from '../../api/cases.ts'
import type { Conversation, TimelineEntry } from '../../api/types.ts'
import { conversationsQuery, SESSION_PARAM } from './useConversation.ts'

type CaseTimelineProps = {
  caseId: number
  /** The chat session currently open, marked in the list. */
  activeConversationId?: number | null
  /** Called when a chat session is chosen, for example to switch to the Chat tab on phones. */
  onSessionSelect?: () => void
  /** When false, sessions are listed but can't be opened, as in the My issues overview. */
  linkSessions?: boolean
}

type TimelineItem =
  | { kind: 'entry'; key: string; time: number; entry: TimelineEntry }
  | { kind: 'session'; key: string; time: number; conversation: Conversation }

/**
 * A case's timeline: entries the person added (or the AI generated) and past chat
 * sessions, oldest first. Sessions link to that chat.
 */
function CaseTimeline({
  caseId,
  activeConversationId,
  onSessionSelect,
  linkSessions = true,
}: CaseTimelineProps) {
  const { t, i18n } = useTranslation()
  const entries = useQuery({
    queryKey: ['cases', caseId, 'timeline'],
    queryFn: () => listTimeline(caseId),
  })
  const conversations = useQuery(conversationsQuery(caseId))

  // Entries have no time of day, so format them in UTC to keep them from shifting a day.
  const dateFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  })
  const dateTimeFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  if (entries.isLoading || conversations.isLoading) {
    return <p role="status">{t('common.loading')}</p>
  }
  if (entries.isError || conversations.isError) {
    return (
      <p className="form-error" role="alert">
        {t('common.serverError')}
      </p>
    )
  }

  const items: TimelineItem[] = [
    ...(entries.data ?? []).map((entry) => ({
      kind: 'entry' as const,
      key: `entry-${entry.id}`,
      time: Date.parse(entry.occurred_at),
      entry,
    })),
    ...(conversations.data ?? []).map((conversation) => ({
      kind: 'session' as const,
      key: `session-${conversation.id}`,
      time: Date.parse(conversation.created_at),
      conversation,
    })),
  ].sort((a, b) => a.time - b.time)

  if (items.length === 0) {
    return <p className="placeholder-notice">{t('case.timelineEmpty')}</p>
  }

  return (
    <ol className="timeline">
      {items.map((item) =>
        item.kind === 'entry' ? (
          <li key={item.key} className="timeline__item">
            <time dateTime={item.entry.occurred_at}>
              {dateFormat.format(new Date(item.entry.occurred_at))}
            </time>
            <span className="timeline__title">
              {item.entry.title}
              {item.entry.source === 'ai' && (
                <>
                  {' '}
                  <span className="timeline__tag">{t('timeline.aiTag')}</span>
                </>
              )}
            </span>
            {item.entry.description && (
              <span className="field-hint">{item.entry.description}</span>
            )}
          </li>
        ) : (
          <li key={item.key} className="timeline__item timeline__item--session">
            {linkSessions ? (
              <Link
                className="timeline__session"
                to={`/cases/${caseId}?${SESSION_PARAM}=${item.conversation.id}`}
                aria-current={item.conversation.id === activeConversationId ? 'true' : undefined}
                onClick={onSessionSelect}
              >
                <time dateTime={item.conversation.created_at}>
                  {dateTimeFormat.format(new Date(item.conversation.created_at))}
                </time>
                <span className="timeline__title">
                  {t('timeline.chatSession')}
                  {item.conversation.id === activeConversationId && (
                    <>
                      {' '}
                      <span className="timeline__tag">{t('timeline.viewing')}</span>
                    </>
                  )}
                </span>
              </Link>
            ) : (
              <>
                <time dateTime={item.conversation.created_at}>
                  {dateTimeFormat.format(new Date(item.conversation.created_at))}
                </time>
                <span className="timeline__title">{t('timeline.chatSession')}</span>
              </>
            )}
          </li>
        ),
      )}
    </ol>
  )
}

export default CaseTimeline
