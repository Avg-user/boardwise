import { ApiError, request } from './client.ts'

/**
 * Voice dictation. The microphone streams to the speech service (a separate container) over a
 * WebSocket, and text comes back as it's recognised. Django only issues a one-time ticket after
 * checking the person owns the case. Audio and text are never stored. Text reaches the AI only
 * when the person presses Send, so the usual crisis and scope checks still apply.
 */

/** `unavailable`: dictation is turned off on the server. `offline`: the speech service can't be reached. */
export type DictationError = 'micDenied' | 'busy' | 'unavailable' | 'offline' | 'tooLong' | 'failed'

type DictationTicket = { ticket: string; url: string; expires_in: number }

type ServerMessage =
  | { type: 'ready' }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'done'; reason: 'stopped' | 'limit' }
  | { type: 'error'; code: 'unauthorized' | 'busy' | 'failed' }

export type DictationCallbacks = {
  /** The unfinished text, which keeps changing. Replaces the previous partial. */
  onPartial: (text: string) => void
  /** Finished text, which won't change again. */
  onFinal: (text: string) => void
  /** Called once when the session ends, with a reason if it didn't end normally. */
  onEnd: (error: DictationError | null) => void
}

export class DictationFailure extends Error {
  code: DictationError

  constructor(code: DictationError) {
    super(`Dictation failed: ${code}`)
    this.name = 'DictationFailure'
    this.code = code
  }
}

export const dictationSupported =
  typeof window !== 'undefined' &&
  typeof WebSocket !== 'undefined' &&
  typeof AudioWorkletNode !== 'undefined' &&
  Boolean(navigator.mediaDevices?.getUserMedia)

const WORKLET_URL = '/pcm-worklet.js'
const STOP_TIMEOUT_MS = 10_000

function websocketUrl(path: string, ticket: string): string {
  const url = new URL(path, window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('ticket', ticket)
  return url.toString()
}

export type DictationSession = {
  /** Stops listening now. Resolves once the server has sent the last words. */
  stop: () => Promise<void>
  /** Ends the session straight away and drops anything not yet final. */
  cancel: () => void
}

export async function startDictation(
  caseId: number,
  language: string,
  callbacks: DictationCallbacks,
  signal?: AbortSignal,
): Promise<DictationSession> {
  let stream: MediaStream | null = null
  let context: AudioContext | null = null
  let ws: WebSocket | null = null
  let ended = false
  let resolveEnded: () => void = () => {}
  const endedPromise = new Promise<void>((resolve) => (resolveEnded = resolve))

  function releaseMic() {
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    void context?.close().catch(() => {})
    context = null
  }

  function end(error: DictationError | null, notify = true) {
    if (ended) return
    ended = true
    releaseMic()
    if (ws && ws.readyState < WebSocket.CLOSING) ws.close()
    if (notify) callbacks.onEnd(error)
    resolveEnded()
  }

  try {
    // Ask for the mic first: the permission prompt can take longer than a ticket lasts.
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
    } catch {
      throw new DictationFailure('micDenied')
    }
    signal?.throwIfAborted()

    let ticket: DictationTicket
    try {
      ticket = await request<DictationTicket>(`/cases/${caseId}/dictation-ticket/`, {
        method: 'POST',
        json: { language },
        signal,
      })
    } catch (error) {
      signal?.throwIfAborted()
      throw new DictationFailure(error instanceof ApiError && error.status === 503 ? 'unavailable' : 'failed')
    }

    const socket = new WebSocket(websocketUrl(ticket.url, ticket.ticket))
    ws = socket
    socket.binaryType = 'arraybuffer'
    await new Promise<void>((resolve, reject) => {
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as ServerMessage
        if (message.type === 'ready') resolve()
        else if (message.type === 'error') reject(new DictationFailure(message.code === 'busy' ? 'busy' : 'failed'))
      }
      // The speech container not running shows up here.
      socket.onerror = () => reject(new DictationFailure('offline'))
      socket.onclose = () => reject(new DictationFailure('failed'))
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    })

    context = new AudioContext()
    await context.audioWorklet.addModule(WORKLET_URL)
    signal?.throwIfAborted()
    const source = context.createMediaStreamSource(stream)
    const capture = new AudioWorkletNode(context, 'pcm-capture')
    let flushed: () => void = () => {}
    capture.port.onmessage = (event: MessageEvent<ArrayBuffer | 'flushed'>) => {
      if (event.data === 'flushed') flushed()
      else if (socket.readyState === WebSocket.OPEN) socket.send(event.data)
    }
    source.connect(capture)
    // The worklet outputs silence; connecting it keeps every browser running it.
    capture.connect(context.destination)

    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage
      if (message.type === 'partial') callbacks.onPartial(message.text)
      else if (message.type === 'final') callbacks.onFinal(message.text)
      else if (message.type === 'done') end(message.reason === 'limit' ? 'tooLong' : null)
      else if (message.type === 'error') end(message.code === 'busy' ? 'busy' : 'failed')
    }
    socket.onerror = null
    socket.onclose = () => end('failed') // no-op if "done" already ended it

    return {
      stop() {
        if (ended) return endedPromise
        let sent = false
        // Send the last audio, then ask the server to finish. Nothing here waits.
        const finish = () => {
          if (sent) return
          sent = true
          releaseMic()
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop' }))
          setTimeout(() => end('failed'), STOP_TIMEOUT_MS) // does nothing if already ended
        }
        flushed = finish
        capture.port.postMessage('flush')
        setTimeout(finish, 100) // in case the worklet never answers
        return endedPromise
      },
      cancel() {
        end(null, false)
      },
    }
  } catch (error) {
    end(null, false)
    throw error
  }
}
