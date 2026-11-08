// Sends chat messages outside the chat screen, so a send keeps going (and stays visible)
// when the person leaves the issue and comes back. One send at a time per issue.
import { useSyncExternalStore } from 'react'
import { createTimelineEntry } from '../../api/cases.ts'
import { createConversation, sendMessage } from '../../api/chat.ts'
import { closeSession, getClosedSessions } from '../../api/closedSessions.ts'
import { getSessionEntries, linkSessionEntry } from '../../api/sessionEntries.ts'
import { queryClient } from '../../queryClient.ts'
import { todayLocal } from '../../utils/date.ts'
import { conversationsQuery, messagesQuery } from './useConversation.ts'

export type PendingSend = {
  /** The chat it's going to. Null until a new chat has been created on the server. */
  conversationId: number | null
  /** Sent from a blank chat, so it shows there even before the new chat is listed. */
  startedBlank: boolean
  content: string
  /** The reply so far, while it streams in. */
  streamed: string
  status: 'sending' | 'failed'
}

let pending: ReadonlyMap<number, PendingSend> = new Map()
const listeners = new Set<() => void>()

function set(caseId: number, value: PendingSend | null) {
  const next = new Map(pending)
  if (value) next.set(caseId, value)
  else next.delete(caseId)
  pending = next
  listeners.forEach((listener) => listener())
}

function update(caseId: number, changes: Partial<PendingSend>) {
  const current = pending.get(caseId)
  if (current) set(caseId, { ...current, ...changes })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The send in progress for this issue, or the last one if it failed. Null otherwise. */
export function usePendingSend(caseId: number): PendingSend | null {
  return useSyncExternalStore(subscribe, () => pending.get(caseId) ?? null)
}

type SendInput = {
  caseId: number
  /** Null starts a new chat, created on the server with this first message. */
  conversationId: number | null
  content: string
  language: string
  /** Title for the chat's timeline entry, if this message creates one. */
  entryTitle: string
}

/**
 * Each chat session is a timeline entry. It's created once the chat's first message has
 * gone through, so failed sends leave nothing behind. Older chats get one with their next message.
 */
async function ensureTimelineEntry(caseId: number, sessionId: number, title: string) {
  if (getSessionEntries().has(sessionId)) return
  try {
    const entry = await createTimelineEntry(caseId, { occurred_at: todayLocal(), title })
    linkSessionEntry(sessionId, entry.id)
    await queryClient.invalidateQueries({ queryKey: ['cases', caseId, 'timeline'] })
  } catch {
    // The chat still works. It shows as a plain chat session until its next message.
  }
}

/** Not cancelled by leaving the screen, so what the app shows matches what the server did. */
export async function sendChatMessage({ caseId, conversationId, content, language, entryTitle }: SendInput) {
  if (pending.get(caseId)?.status === 'sending') return
  set(caseId, {
    conversationId,
    startedBlank: conversationId === null,
    content,
    streamed: '',
    status: 'sending',
  })
  let id = conversationId
  try {
    if (id === null) {
      // Only one chat stays open per issue. The New chat button asks first; this also covers
      // reaching a blank chat some other way. The list is fetched fresh, in case it hadn't loaded.
      const existing = await queryClient.fetchQuery(conversationsQuery(caseId))
      const closed = getClosedSessions()
      for (const item of existing) {
        if (!closed.has(item.id)) closeSession(item.id)
      }
      id = (await createConversation(caseId)).id
      update(caseId, { conversationId: id })
      await queryClient.invalidateQueries({ queryKey: conversationsQuery(caseId).queryKey, exact: true })
    }
    await sendMessage({
      caseId,
      conversationId: id,
      content,
      language,
      onDelta: (piece) => update(caseId, { streamed: (pending.get(caseId)?.streamed ?? '') + piece }),
    })
    // Load the saved messages, then clear the pending bubble straight away, so the reply
    // never shows twice. Load first, so the message doesn't flicker out in between.
    await queryClient.fetchQuery(messagesQuery(caseId, id))
  } catch {
    update(caseId, { status: 'failed' })
    return
  }
  set(caseId, null)
  // Bookkeeping after the message is safely saved. A failure here isn't a failed send.
  await ensureTimelineEntry(caseId, id, entryTitle)
  await queryClient.invalidateQueries({ queryKey: conversationsQuery(caseId).queryKey, exact: true }).catch(() => {})
}
