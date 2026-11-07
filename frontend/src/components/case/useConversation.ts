import { queryOptions, useQuery } from '@tanstack/react-query'
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

/** The case's most recent conversation. Choosing past sessions comes with step 5. */
export function useConversation(caseId: number) {
  const conversations = useQuery(conversationsQuery(caseId))
  const conversationId = conversations.data?.[0]?.id ?? null
  const messages = useQuery({
    ...messagesQuery(caseId, conversationId ?? 0),
    enabled: conversationId !== null,
  })

  return {
    conversationId,
    messages: messages.data ?? [],
    isLoading: conversations.isLoading || messages.isLoading,
    isError: conversations.isError || messages.isError,
  }
}
