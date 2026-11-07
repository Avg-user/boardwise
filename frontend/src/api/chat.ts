import { clearMockMessages, getMockMessages, sendMockMessage } from './chatMock.ts'
import { request } from './client.ts'
import type { ApiMessage, ChatMessage, Conversation } from './types.ts'

export type SendMessageInput = {
  conversationId: number
  content: string
  /** The language the reply should be written in, such as `en` or `fr`. */
  language: string
  /** Called with each piece of the reply as it arrives. */
  onDelta?: (text: string) => void
  signal?: AbortSignal
}

export type SendMessageResult = {
  userMessage: ChatMessage
  /** Null when the message was flagged as a crisis, because resources come before any AI reply. */
  reply: ChatMessage | null
}

function toChatMessages(messages: ApiMessage[]): ChatMessage[] {
  return messages.flatMap((message) =>
    message.role === 'system'
      ? []
      : [{ ...message, role: message.role, citations: [], suggested_steps: [] }],
  )
}

export function listConversations(caseId: number): Promise<Conversation[]> {
  return request<Conversation[]>(`/cases/${caseId}/conversations/`)
}

export function createConversation(caseId: number): Promise<Conversation> {
  return request<Conversation>(`/cases/${caseId}/conversations/`, { method: 'POST' })
}

export async function listMessages(
  caseId: number,
  conversationId: number,
): Promise<ChatMessage[]> {
  const saved = await request<ApiMessage[]>(
    `/cases/${caseId}/conversations/${conversationId}/messages/`,
  )
  return [...toChatMessages(saved), ...getMockMessages(conversationId)].sort(
    (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
  )
}

// MOCK: the backend can't send messages yet (a WebSocket is planned). Swap this
// function for the real call. Messages sent here aren't saved and vanish on reload.
export function sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
  return sendMockMessage(input)
}

export function clearLocalChatData() {
  clearMockMessages()
}
