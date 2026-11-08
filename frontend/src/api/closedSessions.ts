// TEMPORARY: which chat sessions the person has closed, kept in this browser only.
// The backend has no closed state for conversations yet. Replace this file with an
// API call once it does. Until then, closing doesn't follow the person to another
// device, and the API itself still accepts messages to a closed session.
// Only session numbers are stored here, never message content.
import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'boardwise.closedSessions'
const listeners = new Set<() => void>()
let snapshot: ReadonlySet<number> = read()

function read(): ReadonlySet<number> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => Number.isInteger(id)) : [])
  } catch {
    return new Set()
  }
}

function refresh() {
  snapshot = read()
  listeners.forEach((listener) => listener())
}

export function closeSession(conversationId: number) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...snapshot, conversationId]))
    refresh()
  } catch {
    // Without storage, keep it closed for this visit at least.
    snapshot = new Set([...snapshot, conversationId])
    listeners.forEach((listener) => listener())
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Keeps other open tabs in step.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) refresh()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** For use outside React, such as while a message is being sent. */
export function getClosedSessions(): ReadonlySet<number> {
  return snapshot
}

export function useClosedSessions(): ReadonlySet<number> {
  return useSyncExternalStore(subscribe, () => snapshot)
}
