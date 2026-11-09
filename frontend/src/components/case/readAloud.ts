// Reads assistant replies aloud. English uses the speech service's own neural voice (Piper,
// in our container: the text doesn't leave our servers) and highlights each sentence as it's
// read. Otherwise, or when that service is off, the browser's speech synthesis is used, with
// on-device voices only: some browser voices (Chrome's "Google …" ones) send the text to a
// third-party server. With neither, the Listen button stays hidden.
import { useSyncExternalStore } from 'react'
import { streamSpeech, type SpeechStream } from '../../api/voice.ts'
import { markdownToBlocks, runsText } from '../../export/markdownText.ts'
import { pcmToFloat, voiceScore } from './readAloudText.ts'
import { clearHighlight, highlightSentence } from './readingHighlight.ts'

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

/** The best on-device voice for a language such as "en" or "fr". */
function pickVoice(all: SpeechSynthesisVoice[], language: string): SpeechSynthesisVoice | null {
  const base = language.toLowerCase().split('-')[0]
  const local = all.filter(
    (voice) => voice.localService && voice.lang.toLowerCase().replace('_', '-').split('-')[0] === base,
  )
  return local.reduce<SpeechSynthesisVoice | null>(
    (best, voice) => (!best || voiceScore(voice, base) > voiceScore(best, base) ? voice : best),
    null,
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

/** The service voice is English only; it's switched off for the page after it fails once. */
let serverVoiceOff = false
const serverVoiceFor = (language: string | undefined) =>
  !serverVoiceOff && (language ?? '').toLowerCase().split('-')[0] === 'en'

/** Whether the speech service's voice will be tried for this language. */
export function useServerVoice(language: string | undefined): boolean {
  return useSyncExternalStore(subscribeReading, () => serverVoiceFor(language), () => false)
}

/** Whether this reply is being read, paused part-way, or neither. */
export function useReadingState(id: number): ReadingState {
  return useSyncExternalStore(subscribeReading, () => stateOf(id), () => 'idle')
}

/** Drops web addresses, which aren't worth hearing: "label (https://…)" becomes "label". */
function stripAddresses(text: string): string {
  return text
    .replace(/\s*\((?:https?:\/\/|www\.)[^)\s]*\)/g, '')
    .replace(/(?:https?:\/\/|www\.)\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Turns a Markdown reply into short spoken chunks: no symbols, and no web addresses read out. */
export function speechChunks(markdown: string): string[] {
  const chunks: string[] = []
  for (const block of markdownToBlocks(markdown)) {
    if (block.kind === 'rule' || block.kind === 'code') continue
    if (block.kind === 'table') {
      // Each row is read as "Header: value. Header: value."
      const headers = block.header.map(runsText)
      for (const row of block.rows) {
        const parts = row
          .map((cell, index) => [headers[index], runsText(cell).trim()] as const)
          .filter(([, value]) => value)
          .map(([header, value]) => (header ? `${header}: ${value}` : value).replace(/[.!?]*$/, '.'))
        chunks.push(...parts.map(stripAddresses).filter(Boolean))
      }
      continue
    }
    const text = stripAddresses(block.text)
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

// What the service voice is playing, so it can be stopped.
let audioContext: AudioContext | null = null
let stream: SpeechStream | null = null
let sources: AudioBufferSourceNode[] = []
let timers: number[] = []

/** Stops whatever is sounding, from either engine, and clears the highlight. */
function silence() {
  stream?.cancel()
  stream = null
  sources.forEach((source) => {
    source.onended = null
    try {
      source.stop()
    } catch {
      // never started
    }
  })
  sources = []
  timers.forEach((id) => window.clearTimeout(id))
  timers = []
  synth?.cancel()
  clearHighlight()
}

/** Pauses the reply being read, keeping its place. */
export function pauseSpeaking() {
  if (speakingId === null) return
  bookmarks.set(speakingId, currentIndex)
  speakingId = null
  session++
  silence()
  notify()
}

/** Stops everything and forgets every place, e.g. when leaving the chat. */
export function resetSpeaking() {
  const wasActive = speakingId !== null || bookmarks.size > 0
  speakingId = null
  bookmarks.clear()
  session++
  silence()
  if (wasActive) notify()
}

type SpeakOptions = { caseId: number; language: string; voice: SpeechSynthesisVoice | null }

/** Reads a reply aloud, from where it was paused if it was. */
export function speak(id: number, markdown: string, { caseId, language, voice }: SpeakOptions) {
  // Starting this reply pauses any other, so that one can be resumed later too.
  if (speakingId !== null && speakingId !== id) bookmarks.set(speakingId, currentIndex)
  const chunks = speechChunks(markdown)
  const from = Math.min(bookmarks.get(id) ?? 0, Math.max(chunks.length - 1, 0))
  bookmarks.delete(id)
  silence()
  const mySession = ++session
  const useServer = serverVoiceFor(language)
  if (chunks.length === 0 || (!useServer && !(voice && synth))) {
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
    clearHighlight()
    notify()
  }
  const begin = (index: number) => {
    if (session !== mySession) return
    currentIndex = index
    highlightSentence(id, chunks[index])
  }

  if (useServer) speakWithService({ id, caseId, language, chunks, from, mySession, begin, finish, voice })
  else if (voice) speakWithBrowser(chunks, from, voice, mySession, begin, finish)
}

function speakWithBrowser(
  chunks: string[],
  from: number,
  voice: SpeechSynthesisVoice,
  mySession: number,
  begin: (index: number) => void,
  finish: () => void,
) {
  if (!synth) return finish()
  chunks.slice(from).forEach((chunk, offset) => {
    const index = from + offset
    const utterance = new SpeechSynthesisUtterance(chunk)
    utterance.voice = voice
    utterance.lang = voice.lang
    utterance.rate = 0.95 // a touch slower is easier to follow
    utterance.onstart = () => begin(index)
    utterance.onerror = () => {
      if (session === mySession) finish()
    }
    if (index === chunks.length - 1) utterance.onend = finish
    synth.speak(utterance)
  })
}

type ServiceRun = {
  id: number
  caseId: number
  language: string
  chunks: string[]
  from: number
  mySession: number
  begin: (index: number) => void
  finish: () => void
  voice: SpeechSynthesisVoice | null
}

/**
 * Plays the service's audio sentence by sentence, back to back, on one AudioContext. The first
 * sentences come from the head start when there is one; the rest are asked for after them.
 */
function speakWithService({ id, caseId, language, chunks, from, mySession, begin, finish, voice }: ServiceRun) {
  // Created (or resumed) during the click, so the browser lets it play.
  audioContext ??= new AudioContext()
  const context = audioContext
  void context.resume()
  let nextStart = 0
  let playing = 0
  let received = 0
  let allSent = false

  // The service is off or failed before any audio: use the browser's voice instead, and stop
  // trying the service for the rest of the page's life.
  const fallBack = (start: number) => {
    if (session !== mySession) return
    serverVoiceOff = true
    stream = null
    if (voice && synth) speakWithBrowser(chunks, start, voice, mySession, begin, finish)
    else finish()
    notify()
  }
  const sent = () => {
    allSent = true
    stream = null
    if (playing === 0) finish()
  }
  const play = (index: number, sampleRate: number, pcm: Int16Array) => {
    if (session !== mySession || pcm.length === 0) return
    received++
    const buffer = context.createBuffer(1, pcm.length, sampleRate)
    buffer.copyToChannel(pcmToFloat(pcm), 0)
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    const startAt = Math.max(context.currentTime + 0.05, nextStart)
    nextStart = startAt + buffer.duration + 0.15 // a short pause between sentences
    source.start(startAt)
    sources.push(source)
    playing++
    timers.push(window.setTimeout(() => begin(index), (startAt - context.currentTime) * 1000))
    source.onended = () => {
      playing--
      if (allSent && playing === 0) finish()
    }
  }
  const streamFrom = (start: number) => {
    if (session !== mySession) return
    if (start >= chunks.length) return sent()
    streamSpeech(caseId, language, chunks.slice(start), {
      onAudio: (offset, sampleRate, pcm) => play(start + offset, sampleRate, pcm),
      onDone: sent,
      onError() {
        if (received === 0) fallBack(start)
        else sent() // play what arrived, then stop
      },
    }).then(
      (started) => {
        if (session === mySession) stream = started
        else started.cancel()
      },
      () => (received === 0 ? fallBack(start) : sent()),
    )
  }

  const head = headStartFor(id, chunks)
  if (!head || from >= head.chunks.length) return streamFrom(from)
  // Play the head start as it's ready (usually all of it already is), then ask for the rest.
  let cursor = from
  const drain = () => {
    if (session !== mySession) return head.listeners.delete(drain)
    for (let audio = head.audio[cursor]; cursor < head.chunks.length && audio; audio = head.audio[cursor]) {
      play(cursor, audio.rate, audio.pcm)
      cursor++
    }
    if (cursor < head.chunks.length && !head.settled) return
    head.listeners.delete(drain)
    streamFrom(cursor)
  }
  head.listeners.add(drain)
  drain()
}

// --- Head start -----------------------------------------------------------------------------
// When a reply arrives, its first few sentences are made straight away, so Listen starts at
// once; the rest is made while those play. Only in this page's memory, never stored, and only
// for the last few replies.

const HEAD_START_SENTENCES = 3
const HEAD_START_KEEP = 5

type HeadStart = {
  chunks: string[]
  audio: ({ rate: number; pcm: Int16Array } | undefined)[]
  /** Finished, or gave up: nothing more will arrive. */
  settled: boolean
  listeners: Set<() => void>
}

const headStarts = new Map<number, HeadStart>()
let preparing = false

/** The head start for this reply, if it was made from the same sentences. */
function headStartFor(id: number, chunks: string[]): HeadStart | null {
  const head = headStarts.get(id)
  return head && head.chunks.every((chunk, index) => chunk === chunks[index]) ? head : null
}

/** Makes the first sentences of a new reply ahead of Listen. One at a time; skipped when busy. */
export function prepareSpeech(id: number, markdown: string, caseId: number, language: string) {
  if (!serverVoiceFor(language) || preparing || headStarts.has(id)) return
  const chunks = speechChunks(markdown).slice(0, HEAD_START_SENTENCES)
  if (chunks.length === 0) return
  const head: HeadStart = { chunks, audio: [], settled: false, listeners: new Set() }
  headStarts.set(id, head)
  while (headStarts.size > HEAD_START_KEEP) headStarts.delete(headStarts.keys().next().value!)
  preparing = true
  const changed = () => [...head.listeners].forEach((listener) => listener())
  const settle = () => {
    if (head.settled) return
    head.settled = true
    preparing = false
    changed()
  }
  streamSpeech(caseId, language, chunks, {
    onAudio(index, rate, pcm) {
      head.audio[index] = { rate, pcm }
      changed()
    },
    onDone: settle,
    onError: settle,
  }).then((started) => {
    if (head.settled) started.cancel()
  }, settle)
}
