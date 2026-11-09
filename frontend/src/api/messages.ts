import { request } from './client.ts'

// Matches the messages API in apps/lawfirms. A thread is one worker and one firm.
// Firms never get the worker's username: "worker" is all they see of the sender.

export type MessageSide = 'worker' | 'firm'

export type ThreadMessage = {
  id: number
  sender: MessageSide
  body: string
  created_at: string
  /** True for messages the signed-in person sent. */
  mine: boolean
}

export type Thread = {
  id: number
  firm: number
  firm_name: string
  subject: string
  created_at: string
  last_message_at: string
  /** The other side wrote since this person last opened the thread. */
  unread: boolean
  last_message: { sender: MessageSide; preview: string; mine: boolean } | null
}

export type ThreadDetail = Thread & {
  messages: ThreadMessage[]
  can_reply: boolean
}

export const THREADS_KEY = ['messages'] as const
export const UNREAD_KEY = ['messages', 'unread'] as const

export function listThreads(): Promise<Thread[]> {
  return request<Thread[]>('/messages/')
}

/** Opening a thread marks it read. */
export function getThread(id: number): Promise<ThreadDetail> {
  return request<ThreadDetail>(`/messages/${id}/`)
}

/** Worker only. A second message to the same firm joins the existing thread. */
export function startThread(input: { firm: number; subject: string; body: string }): Promise<ThreadDetail> {
  return request<ThreadDetail>('/messages/', { method: 'POST', json: input })
}

export function replyToThread(id: number, body: string): Promise<ThreadDetail> {
  return request<ThreadDetail>(`/messages/${id}/reply/`, { method: 'POST', json: { body } })
}

export async function unreadCount(): Promise<number> {
  return (await request<{ unread: number }>('/messages/unread/')).unread
}
