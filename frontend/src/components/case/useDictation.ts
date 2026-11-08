import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DictationFailure,
  dictationSupported,
  startDictation,
  type DictationError,
  type DictationSession,
} from '../../api/dictation.ts'

export type DictationStatus = 'idle' | 'connecting' | 'listening'

type UseDictationOptions = {
  caseId: number
  language: string
  /** Called with each piece of finished text, to add to the draft. */
  onFinal: (text: string) => void
  /** Called on Stop with the grey words, so they go in the draft before the server confirms them. */
  onStop: (partial: string) => void
}

/** Voice typing for the chat box: grey `partial` text while speaking, `onFinal` once it settles. */
export function useDictation({ caseId, language, onFinal, onStop }: UseDictationOptions) {
  const [status, setStatus] = useState<DictationStatus>('idle')
  const [partial, setPartial] = useState('')
  const [error, setError] = useState<DictationError | null>(null)
  // Hidden for the rest of the visit once the server says dictation is turned off.
  const [available, setAvailable] = useState(dictationSupported)
  const sessionRef = useRef<DictationSession | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const onFinalRef = useRef(onFinal)
  const onStopRef = useRef(onStop)
  const partialRef = useRef('')

  useEffect(() => {
    onFinalRef.current = onFinal
    onStopRef.current = onStop
  })

  const fail = useCallback((code: DictationError | null) => {
    partialRef.current = ''
    setPartial('')
    setStatus('idle')
    setError(code)
    if (code === 'unavailable') {
      setAvailable(false)
    }
  }, [])

  const start = useCallback(async () => {
    if (sessionRef.current || abortRef.current) {
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setPartial('')
    setStatus('connecting')
    try {
      // A stopped session can still be sending its last words while a new one starts,
      // so each callback checks which session it belongs to.
      const session: DictationSession = await startDictation(
        caseId,
        language,
        {
          onPartial: (text) => {
            if (sessionRef.current !== session) return // stopped: ignore late grey text
            partialRef.current = text
            setPartial(text)
          },
          onFinal: (text) => {
            if (sessionRef.current === session) {
              partialRef.current = ''
              setPartial('')
            }
            onFinalRef.current(text)
          },
          onEnd: (code) => {
            if (sessionRef.current === session) {
              sessionRef.current = null
              fail(code)
            } else if (code) {
              setError(code)
            }
          },
        },
        controller.signal,
      )
      sessionRef.current = session
      setStatus('listening')
    } catch (caught) {
      if (!controller.signal.aborted) {
        fail(caught instanceof DictationFailure ? caught.code : 'failed')
      }
    } finally {
      abortRef.current = null
    }
  }, [caseId, language, fail])

  /** Stops listening at once. Resolves when the last words have arrived. */
  const stop = useCallback((): Promise<void> => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
      fail(null)
      return Promise.resolve()
    }
    const session = sessionRef.current
    if (!session) {
      return Promise.resolve()
    }
    sessionRef.current = null
    const tail = partialRef.current
    partialRef.current = ''
    setPartial('')
    setStatus('idle')
    if (tail) onStopRef.current(tail)
    return session.stop()
  }, [fail])

  // Release the microphone when leaving the screen.
  useEffect(
    () => () => {
      abortRef.current?.abort()
      sessionRef.current?.cancel()
    },
    [],
  )

  return { status, partial, error, available, start, stop, clearError: () => setError(null) }
}
