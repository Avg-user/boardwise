import { request } from './client.ts'
import type { ApiMessage, ChatMessage, Conversation, SendMessageResponse } from './types.ts'

export type SendMessageInput = {
  caseId: number
  conversationId: number
  content: string
  /** The language the reply should be written in, such as `en` or `fr`. */
  language: string
  /** Title and local date for the chat's timeline entry, if this message creates it. */
  entryTitle?: string
  entryDate?: string
  /** Called with each piece of the reply as it arrives. Until WebSocket streaming exists, called once with the whole reply. */
  onDelta?: (text: string) => void
  signal?: AbortSignal
}

export type SendMessageResult = {
  userMessage: ChatMessage
  /** Null when the message was flagged as a crisis, because resources come before any AI reply. */
  reply: ChatMessage | null
}

function toChatMessage(message: ApiMessage & { role: 'user' | 'assistant' }): ChatMessage {
  return { ...message, citations: [], suggested_steps: [] }
}

function toChatMessages(messages: ApiMessage[]): ChatMessage[] {
  return messages.flatMap((message) =>
    message.role === 'system' ? [] : [toChatMessage({ ...message, role: message.role })],
  )
}

export function listConversations(caseId: number): Promise<Conversation[]> {
  return request<Conversation[]>(`/cases/${caseId}/conversations/`)
}

export function createConversation(caseId: number): Promise<Conversation> {
  return request<Conversation>(`/cases/${caseId}/conversations/`, { method: 'POST' })
}

/** Closes a chat for good: it stays readable, and the server refuses new messages to it. */
export function closeConversation(caseId: number, conversationId: number): Promise<Conversation> {
  return request<Conversation>(`/cases/${caseId}/conversations/${conversationId}/close/`, { method: 'POST' })
}

export async function listMessages(
  caseId: number,
  conversationId: number,
): Promise<ChatMessage[]> {
  const saved = await request<ApiMessage[]>(
    `/cases/${caseId}/conversations/${conversationId}/messages/`,
  )
  return toChatMessages(saved)
}

/**
 * Sends a message and waits for the whole reply. The backend checks for a crisis first:
 * a flagged message is saved but never sent to the AI, and `reply` is null.
 * On failure (for example a 502 when the model is down) nothing is saved, so resending is safe.
 */
export async function sendMessage({
  caseId,
  conversationId,
  content,
  language,
  entryTitle,
  entryDate,
  onDelta,
  signal,
}: SendMessageInput): Promise<SendMessageResult> {
  const result = await request<SendMessageResponse>(
    `/cases/${caseId}/conversations/${conversationId}/messages/`,
    {
      method: 'POST',
      json: { content, language, entry_title: entryTitle, entry_date: entryDate },
      signal,
    },
  )
  if (result.reply) {
    onDelta?.(result.reply.content)
  }
  return {
    userMessage: toChatMessage({ ...result.user_message, role: 'user' }),
    reply: result.reply ? toChatMessage({ ...result.reply, role: 'assistant' }) : null,
  }
}
