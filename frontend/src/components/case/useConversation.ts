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
/** `?session=new` shows a blank chat. The session itself is only created when the first message is sent. */
export const NEW_SESSION = 'new'

/**
 * The chat session being viewed. That's the one named in the URL if it belongs to this
 * case. Otherwise it's the current session: the most recent one that isn't closed. If
 * every session is closed there's no current one, and the next message starts a new chat.
 */
export function useConversation(caseId: number) {
  const [searchParams] = useSearchParams()
  const param = searchParams.get(SESSION_PARAM)
  const wantsNew = param === NEW_SESSION
  const requestedId = Number(param)
  const conversations = useQuery(conversationsQuery(caseId))
  const list = conversations.data ?? []
  // The list is newest first. The server keeps at most one chat open per issue.
  const current = list.find((item) => item.closed_at === null) ?? null
  const conversation = wantsNew
    ? null
    : (list.find((item) => item.id === requestedId) ?? current)
  const conversationId = conversation?.id ?? null
  const messages = useQuery({
    ...messagesQuery(caseId, conversationId ?? 0),
    enabled: conversationId !== null,
  })

  return {
    conversationId,
    conversation,
    /** The open chat, if any. Only one is kept open per issue. */
    current,
    /** True on `?session=new`: a blank chat not yet created on the server. */
    isNewChat: wantsNew,
    isCurrent: wantsNew || conversation === current,
    isClosed: conversation !== null && conversation.closed_at !== null,
    messages: messages.data ?? [],
    isLoading: conversations.isLoading || messages.isLoading,
    isError: conversations.isError || messages.isError,
  }
}
