import { queryOptions, useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { listConversations, listMessages } from '../../api/chat.ts'

export function conversationsQuery(caseId: number) {
  return queryOptions({
    queryKey: ['cases', caseId, 'conversations'],
    queryFn: () => listConversations(caseId),
  })
}

export function messagesQuery(caseId: number, conversationId: number) {
  return queryOptions({
    queryKey: ['cases', caseId, 'conversations', conversationId, 'messages'],
    queryFn: () => listMessages(caseId, conversationId),
  })
}

/** The URL parameter that picks a past chat session, as in `/cases/4?session=12`. */
export const SESSION_PARAM = 'session'

/**
 * The chat session being viewed: the one named in the URL if it belongs to this case,
 * otherwise the most recent.
 */
export function useConversation(caseId: number) {
  const [searchParams] = useSearchParams()
  const requestedId = Number(searchParams.get(SESSION_PARAM))
  const conversations = useQuery(conversationsQuery(caseId))
  const list = conversations.data ?? []
  const latest = list[0] ?? null
  const conversation = list.find((item) => item.id === requestedId) ?? latest
  const conversationId = conversation?.id ?? null
  const messages = useQuery({
    ...messagesQuery(caseId, conversationId ?? 0),
    enabled: conversationId !== null,
  })

  return {
    conversationId,
    conversation,
    isLatest: conversation === latest,
    messages: messages.data ?? [],
    isLoading: conversations.isLoading || messages.isLoading,
    isError: conversations.isError || messages.isError,
  }
}
