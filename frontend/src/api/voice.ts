import { request } from './client.ts'
import { websocketUrl } from './dictation.ts'

/**
 * Read-aloud with the speech service's own voice (Piper, running in our container), so the
 * reply's text never goes to a third party. Django issues a one-time "read" ticket after
 * checking the person owns the case; the service sends back audio one sentence at a time.
 */

type SpeechTicket = { ticket: string; url: string; expires_in: number }

type ServerMessage =
  | { type: 'audio'; index: number; sample_rate: number }
  | { type: 'done' }
  | { type: 'error'; code: string }

export type SpeechHandlers = {
  /** One sentence's audio, in order. `index` is its position in the chunks that were sent. */
  onAudio: (index: number, sampleRate: number, pcm: Int16Array) => void
  /** Every sentence has been sent. */
  onDone: () => void
  /** The service failed or the connection dropped before `onDone`. */
  onError: () => void
}

export type SpeechStream = { cancel: () => void }

/** Starts reading `chunks` aloud. Rejects if no ticket could be had (e.g. 503: the voice is off). */
export async function streamSpeech(
  caseId: number,
  language: string,
  chunks: string[],
  handlers: SpeechHandlers,
): Promise<SpeechStream> {
  const ticket = await request<SpeechTicket>(`/cases/${caseId}/dictation-ticket/`, {
    method: 'POST',
    json: { language, purpose: 'read' },
  })

  const socket = new WebSocket(websocketUrl(ticket.url, ticket.ticket))
  socket.binaryType = 'arraybuffer'
  let header: { index: number; rate: number } | null = null
  let finished = false

  const finish = (ok: boolean) => {
    if (finished) return
    finished = true
    if (ok) handlers.onDone()
    else handlers.onError()
  }

  socket.onopen = () => socket.send(JSON.stringify({ type: 'speak', chunks }))
  socket.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      if (header && !finished) handlers.onAudio(header.index, header.rate, new Int16Array(event.data))
      header = null
      return
    }
    let message: ServerMessage
    try {
      message = JSON.parse(event.data as string) as ServerMessage
    } catch {
      return
    }
    if (message.type === 'audio') header = { index: message.index, rate: message.sample_rate }
    else if (message.type === 'done') finish(true)
    else if (message.type === 'error') finish(false)
  }
  socket.onerror = () => finish(false)
  socket.onclose = () => finish(false) // no-op after done

  return {
    cancel() {
      finished = true
      if (socket.readyState < WebSocket.CLOSING) socket.close()
    },
  }
}
