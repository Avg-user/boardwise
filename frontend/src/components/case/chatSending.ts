// Sends chat messages outside the chat screen, so a send keeps going (and stays visible)
// when the person leaves the issue and comes back. One send at a time per issue.
import { useSyncExternalStore } from 'react'
import { createConversation, sendMessage } from '../../api/chat.ts'
import { ApiError } from '../../api/client.ts'
import { queryClient } from '../../queryClient.ts'
import { todayLocal } from '../../utils/date.ts'
import { prepareSpeech } from './readAloud.ts'
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
  /** Why it failed: 'closed' when the chat was closed elsewhere (another device, the API). */
  failure?: 'closed'
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
      // The server closes any chat still open on this issue: only one stays open.
      id = (await createConversation(caseId)).id
      update(caseId, { conversationId: id })
      await queryClient.invalidateQueries({ queryKey: conversationsQuery(caseId).queryKey, exact: true })
    }
    const { reply } = await sendMessage({
      caseId,
      conversationId: id,
      content,
      language,
      // The server makes the chat's timeline entry with its first saved message.
      entryTitle,
      entryDate: todayLocal(),
      onDelta: (piece) => update(caseId, { streamed: (pending.get(caseId)?.streamed ?? '') + piece }),
    })
    // Make the reply's first sentences now, so Listen starts at once.
    if (reply) prepareSpeech(reply.id, reply.content, caseId, language)
    // Load the saved messages, then clear the pending bubble straight away, so the reply
    // never shows twice. Load first, so the message doesn't flicker out in between.
    await queryClient.fetchQuery(messagesQuery(caseId, id))
  } catch (error) {
    const closedElsewhere = error instanceof ApiError && error.status === 409
    update(caseId, { status: 'failed', failure: closedElsewhere ? 'closed' : undefined })
    // 409: the chat was closed elsewhere, e.g. on another device. Reload so it shows as closed.
    if (closedElsewhere) {
      await queryClient.invalidateQueries({ queryKey: conversationsQuery(caseId).queryKey, exact: true }).catch(() => {})
    }
    return
  }
  set(caseId, null)
  // The first message may have created the chat's timeline entry.
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['cases', caseId, 'timeline'] }),
    queryClient.invalidateQueries({ queryKey: conversationsQuery(caseId).queryKey, exact: true }),
  ]).catch(() => {})
}
