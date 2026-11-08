// TEMPORARY: which timeline entry belongs to which chat session, kept in this browser only.
// Each chat session is a timeline entry, but the backend has no link between the two yet.
// Replace this file with a `conversation` field on timeline entries once it exists. Until
// then, on another device the entry shows without its link and the chat as a plain session.
// Only ID numbers are stored here, never content.
import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'boardwise.sessionEntries'
const listeners = new Set<() => void>()
/** Chat session ID → timeline entry ID. */
let snapshot: ReadonlyMap<number, number> = read()

function read(): ReadonlyMap<number, number> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    const entries = Object.entries(parsed && typeof parsed === 'object' ? parsed : {})
      .map(([session, entry]) => [Number(session), entry] as const)
      .filter((pair): pair is [number, number] => Number.isInteger(pair[0]) && Number.isInteger(pair[1]))
    return new Map(entries)
  } catch {
    return new Map()
  }
}

function save(next: ReadonlyMap<number, number>) {
  snapshot = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(next)))
  } catch {
    // Without storage the link lasts for this visit only.
  }
  listeners.forEach((listener) => listener())
}

export function linkSessionEntry(conversationId: number, entryId: number) {
  save(new Map([...snapshot, [conversationId, entryId]]))
}

export function unlinkEntry(entryId: number) {
  save(new Map([...snapshot].filter(([, entry]) => entry !== entryId)))
}

/** For use outside React, such as right after sending a message. */
export function getSessionEntries(): ReadonlyMap<number, number> {
  return snapshot
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      snapshot = read()
      listeners.forEach((l) => l())
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useSessionEntries(): ReadonlyMap<number, number> {
  return useSyncExternalStore(subscribe, () => snapshot)
}
