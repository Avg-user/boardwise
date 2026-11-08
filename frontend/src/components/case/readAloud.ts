// Reads assistant replies aloud with the browser's own speech synthesis. Only voices that
// run on the device are used: some browser voices (Chrome's "Google …" ones) send the text
// to a server, and these conversations must not leave the person's device that way. When
// there's no on-device voice for the language, the Listen button stays hidden.
import { useSyncExternalStore } from 'react'
import { markdownToBlocks } from '../../export/markdownText.ts'

const synth: SpeechSynthesis | null =
  typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null

// --- Voices -------------------------------------------------------------------------------
// Browsers fill in the voice list a moment after the page loads: Chrome announces it with
// `voiceschanged`, often before the chat is even open, and Safari may not announce it at
// all. So the list is re-read whenever it's asked for, and the cached copy is replaced only
// when it really changed (useSyncExternalStore needs the same array back otherwise).

const NO_VOICES: SpeechSynthesisVoice[] = []
let voices: SpeechSynthesisVoice[] = NO_VOICES
let voicesKey = ''
const voiceListeners = new Set<() => void>()

/** Re-reads the browser's voices. True when the list changed. */
function refreshVoices(): boolean {
  const next = synth?.getVoices() ?? NO_VOICES
  const key = next.map((voice) => `${voice.voiceURI}|${voice.lang}|${voice.localService}`).join('\n')
  if (key === voicesKey) return false
  voices = next.length > 0 ? next : NO_VOICES
  voicesKey = key
  return true
}

function notifyVoices() {
  if (refreshVoices()) voiceListeners.forEach((listener) => listener())
}

// Listen for the whole life of the page, so an early announcement isn't missed.
synth?.addEventListener('voiceschanged', notifyVoices)

function subscribeVoices(onChange: () => void) {
  voiceListeners.add(onChange)
  // For browsers that never announce: look again a few times over the first few seconds.
  const retries = [250, 1000, 3000].map((delay) => window.setTimeout(notifyVoices, delay))
  return () => {
    voiceListeners.delete(onChange)
    retries.forEach((id) => window.clearTimeout(id))
  }
}

function getVoices(): SpeechSynthesisVoice[] {
  refreshVoices()
  return voices
}

/** The best on-device voice for a language such as "en" or "fr", preferring Canadian ones. */
function pickVoice(all: SpeechSynthesisVoice[], language: string): SpeechSynthesisVoice | null {
  const base = language.toLowerCase().split('-')[0]
  const local = all.filter(
    (voice) => voice.localService && voice.lang.toLowerCase().replace('_', '-').split('-')[0] === base,
  )
  return (
    local.find((voice) => voice.lang.toLowerCase().replace('_', '-') === `${base}-ca`) ??
    local.find((voice) => voice.default) ??
    local[0] ??
    null
  )
}

/** The on-device voice for this language, or null when reading aloud isn't available. */
export function useLocalVoice(language: string | undefined): SpeechSynthesisVoice | null {
  const all = useSyncExternalStore(subscribeVoices, getVoices, () => NO_VOICES)
  return language ? pickVoice(all, language) : null
}

// --- What's playing -----------------------------------------------------------------------
// One reply at a time, app-wide. Pausing remembers the sentence it reached, so Resume
// carries on from there. (The browser's own pause() is unreliable, Android Chrome ignores
// it, so a pause is really a stop plus a bookmark.)

export type ReadingState = 'idle' | 'speaking' | 'paused'

let speakingId: number | null = null
/** Where each paused reply stopped: the index of the sentence to resume from. */
const bookmarks = new Map<number, number>()
/** The sentence being spoken now. */
let currentIndex = 0
/** Bumped on every start and stop, so late events from cancelled speech are ignored. */
let session = 0
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((listener) => listener())
}

function subscribeReading(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function stateOf(id: number): ReadingState {
  if (speakingId === id) return 'speaking'
  return bookmarks.has(id) ? 'paused' : 'idle'
}

/** Whether this reply is being read, paused part-way, or neither. */
export function useReadingState(id: number): ReadingState {
  return useSyncExternalStore(subscribeReading, () => stateOf(id), () => 'idle')
}

/** Turns a Markdown reply into short spoken chunks: no symbols, and no web addresses read out. */
export function speechChunks(markdown: string): string[] {
  const chunks: string[] = []
  for (const block of markdownToBlocks(markdown)) {
    if (block.kind === 'rule' || block.kind === 'code') continue
    const text = block.text
      .replace(/\s*\((?:https?:\/\/|www\.)[^)\s]*\)/g, '') // "label (https://…)" → "label"
      .replace(/(?:https?:\/\/|www\.)\S+/g, '') // bare addresses
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) continue
    // Long blocks are split by sentence: some browsers cut off a single long utterance.
    const sentences = (text.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) ?? [text])
      .map((part) => part.trim())
      .filter(Boolean)
    // Numbered steps keep their number; bullets and checkboxes are just pauses.
    if (block.kind === 'item' && /^\d/.test(block.marker) && sentences.length > 0) {
      sentences[0] = `${block.marker} ${sentences[0]}`
    }
    chunks.push(...sentences)
  }
  return chunks
}

/** Pauses the reply being read, keeping its place. */
export function pauseSpeaking() {
  if (speakingId === null) return
  bookmarks.set(speakingId, currentIndex)
  speakingId = null
  session++
  synth?.cancel()
  notify()
}

/** Stops everything and forgets every place, e.g. when leaving the chat. */
export function resetSpeaking() {
  const wasActive = speakingId !== null || bookmarks.size > 0
  speakingId = null
  bookmarks.clear()
  session++
  synth?.cancel()
  if (wasActive) notify()
}

/** Reads a reply aloud, from where it was paused if it was. */
export function speak(id: number, markdown: string, voice: SpeechSynthesisVoice) {
  if (!synth) return
  // Starting this reply pauses any other, so that one can be resumed later too.
  if (speakingId !== null && speakingId !== id) bookmarks.set(speakingId, currentIndex)
  const chunks = speechChunks(markdown)
  const from = Math.min(bookmarks.get(id) ?? 0, Math.max(chunks.length - 1, 0))
  bookmarks.delete(id)
  synth.cancel()
  const mySession = ++session
  if (chunks.length === 0) {
    speakingId = null
    notify()
    return
  }
  speakingId = id
  currentIndex = from
  notify()

  const finish = () => {
    if (session !== mySession) return
    speakingId = null
    session++
    notify()
  }
  chunks.slice(from).forEach((chunk, offset) => {
    const index = from + offset
    const utterance = new SpeechSynthesisUtterance(chunk)
    utterance.voice = voice
    utterance.lang = voice.lang
    utterance.onstart = () => {
      if (session === mySession) currentIndex = index
    }
    utterance.onerror = finish
    if (index === chunks.length - 1) utterance.onend = finish
    synth.speak(utterance)
  })
}
