import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { createConversation, sendMessage } from '../../api/chat.ts'
import type { ChatMessage } from '../../api/types.ts'
import { OwlMark } from '../brand/Owl.tsx'
import CrisisBanner from './CrisisBanner.tsx'
import Markdown from './Markdown.tsx'
import { conversationsQuery, messagesQuery, useConversation } from './useConversation.ts'
import { useDictation } from './useDictation.ts'

const DICTATION_ERRORS = {
  micDenied: 'chat.dictation.micDenied',
  busy: 'chat.dictation.busy',
  unavailable: 'chat.dictation.unavailable',
  offline: 'chat.dictation.offline',
  tooLong: 'chat.dictation.tooLong',
  failed: 'chat.dictation.failed',
} as const

/** Adds dictated text to the draft with a single space between them. */
function appendText(draft: string, text: string): string {
  const head = draft.trimEnd()
  return head ? `${head} ${text}` : text
}

type ChatPanelProps = {
  caseId: number
  canEdit: boolean
}

function AssistantLabel() {
  const { t } = useTranslation()
  return (
    <span className="ai-label">
      <OwlMark className="owl-mark--tiny" />
      {t('chat.aiLabel')}
    </span>
  )
}

function Message({ message }: { message: ChatMessage }) {
  const { t } = useTranslation()

  if (message.role === 'user') {
    return <p className="message message--user">{message.content}</p>
  }
  return (
    <div className="message message--assistant">
      <AssistantLabel />
      <Markdown text={message.content} />
      {message.citations.length > 0 && (
        <div className="citations">
          <span className="citations__label">{t('chat.sources')}</span>
          <ul>
            {message.citations.map((citation) => (
              <li key={citation.url}>
                <a href={citation.url} target="_blank" rel="noopener noreferrer">
                  {citation.title}
                  <span className="visually-hidden"> {t('common.opensInNewTab')}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function ChatPanel({ caseId, canEdit }: ChatPanelProps) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const { conversationId, conversation, isLatest, messages, isLoading, isError } =
    useConversation(caseId)
  const sessionDate = conversation
    ? new Intl.DateTimeFormat(i18n.resolvedLanguage, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(conversation.created_at))
    : ''
  const [draft, setDraftState] = useState('')
  // Mirrors `draft` without waiting for a render, so send() sees text dictated just before it.
  const draftRef = useRef('')
  const setDraft = useCallback((update: string | ((current: string) => string)) => {
    draftRef.current = typeof update === 'function' ? update(draftRef.current) : update
    setDraftState(draftRef.current)
  }, [])
  const [pendingText, setPendingText] = useState<string | null>(null)
  const [streamedText, setStreamedText] = useState('')
  const [sendFailed, setSendFailed] = useState(false)
  const [dismissedCrisisId, setDismissedCrisisId] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const crisisRef = useRef<HTMLDivElement>(null)
  const dictationBoxRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Grey words added on Stop. The server's final text replaces them, unless the person edited them.
  const provisionalRef = useRef<string | null>(null)
  const dictation = useDictation({
    caseId,
    language: i18n.resolvedLanguage ?? 'en',
    onFinal: (text) =>
      setDraft((current) => {
        const provisional = provisionalRef.current
        if (provisional === null) return appendText(current, text)
        provisionalRef.current = null
        if (!current.endsWith(provisional)) return current // edited since Stop: keep theirs
        return appendText(current.slice(0, -provisional.length), text)
      }),
    onStop: (partial) => {
      provisionalRef.current = partial
      setDraft((current) => appendText(current, partial))
    },
  })
  const isDictating = dictation.status !== 'idle'
  const wasDictating = useRef(false)

  const isSending = pendingText !== null
  const latestCrisisId = messages.findLast((message) => message.flagged_crisis)?.id ?? null
  const showCrisisBanner =
    canEdit && latestCrisisId !== null && latestCrisisId !== dismissedCrisisId

  // Stop a reply that's still streaming when leaving the screen.
  useEffect(() => () => abortRef.current?.abort(), [])

  // Follow new content, unless the person has scrolled up to read earlier messages.
  useEffect(() => {
    const end = endRef.current
    if (!showCrisisBanner && end && end.getBoundingClientRect().top <= window.innerHeight + 240) {
      end.scrollIntoView({ block: 'end' })
    }
  }, [messages.length, pendingText, streamedText, showCrisisBanner])

  // The banner can be taller than a phone screen, so bring its top ("Call 911") into view.
  useEffect(() => {
    if (showCrisisBanner) {
      crisisRef.current?.scrollIntoView({ block: 'start' })
    }
  }, [showCrisisBanner, latestCrisisId])

  // Keep the newest dictated words in view while the box grows.
  useEffect(() => {
    const box = dictationBoxRef.current
    if (box) {
      box.scrollTop = box.scrollHeight
    }
  }, [draft, dictation.partial])

  // Back to the editable box when dictation ends, so corrections are one click away.
  useEffect(() => {
    if (wasDictating.current && !isDictating) {
      textareaRef.current?.focus()
    }
    wasDictating.current = isDictating
  }, [isDictating])

  async function send() {
    if (isSending) {
      return
    }
    // Sending while dictating: stop, and wait up to a second for the last words.
    if (isDictating) {
      await Promise.race([dictation.stop(), new Promise((resolve) => setTimeout(resolve, 1000))])
    }
    const content = draftRef.current.trim()
    if (!content) {
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setDraft('')
    setSendFailed(false)
    setStreamedText('')
    setPendingText(content)
    try {
      const id = conversationId ?? (await createConversation(caseId)).id
      await sendMessage({
        caseId,
        conversationId: id,
        content,
        language: i18n.resolvedLanguage ?? 'en',
        onDelta: (piece) => setStreamedText((current) => current + piece),
        signal: controller.signal,
      })
      // Load the messages first, so they don't flicker out when pending text clears.
      await queryClient.fetchQuery(messagesQuery(caseId, id))
      await queryClient.invalidateQueries({
        queryKey: conversationsQuery(caseId).queryKey,
        exact: true,
      })
    } catch {
      if (controller.signal.aborted) {
        return
      }
      setDraft(content)
      setSendFailed(true)
    }
    setPendingText(null)
    setStreamedText('')
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void send()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing keeps Enter from sending while typing accented characters with an IME.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void send()
    }
  }

  return (
    <div className="chat">
      {!isLatest && (
        <p className="session-notice">
          {t('chat.earlierSession', { date: sessionDate })}{' '}
          <Link to={{ search: '' }}>{t('chat.latestSession')}</Link>
        </p>
      )}
      <div className="chat__log" role="log" aria-busy={isSending} aria-label={t('chat.logLabel')}>
        {isLoading && <p role="status">{t('common.loading')}</p>}
        {isError && (
          <p className="form-error" role="alert">
            {t('common.serverError')}
          </p>
        )}
        {!isLoading && !isError && messages.length === 0 && !isSending && (
          <div className="message message--assistant">
            <AssistantLabel />
            <p>{t('chat.intro')}</p>
          </div>
        )}
        {messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}
        {pendingText !== null && <p className="message message--user">{pendingText}</p>}
        {isSending && (
          <div className="message message--assistant">
            <AssistantLabel />
            <p>{streamedText || t('chat.thinking')}</p>
          </div>
        )}
      </div>

      {/* Below the newest message, so it's on screen however long the conversation is. */}
      {showCrisisBanner && (
        <div ref={crisisRef} className="chat__crisis">
          <CrisisBanner onDismiss={() => setDismissedCrisisId(latestCrisisId)} />
        </div>
      )}
      <div ref={endRef} className="chat__end" />

      {canEdit ? (
        <form className="composer-area" onSubmit={handleSubmit}>
          {sendFailed && (
            <p className="form-error" role="alert">
              {t('chat.sendFailed')}
            </p>
          )}
          {dictation.error && (
            <p className="form-error" role="alert">
              {t(DICTATION_ERRORS[dictation.error])}
            </p>
          )}
          <div className="composer">
            <label className="visually-hidden" htmlFor="chat-message" id="chat-message-label">
              {t('chat.messageLabel')}
            </label>
            {isDictating ? (
              // Read-only while listening: finished words solid, the words still changing grey.
              <div
                ref={dictationBoxRef}
                id="chat-message"
                className="composer__dictation"
                role="textbox"
                aria-readonly="true"
                aria-multiline="true"
                aria-labelledby="chat-message-label"
              >
                {draft.trim() || dictation.partial ? (
                  <>
                    {draft.trimEnd()}
                    {draft.trim() && dictation.partial ? ' ' : ''}
                    {dictation.partial && (
                      <span className="composer__partial">{dictation.partial}</span>
                    )}
                  </>
                ) : (
                  <span className="composer__partial">
                    {dictation.status === 'connecting'
                      ? t('chat.dictation.connecting')
                      : t('chat.dictation.listening')}
                  </span>
                )}
              </div>
            ) : (
              <textarea
                ref={textareaRef}
                id="chat-message"
                rows={1}
                placeholder={t('chat.placeholder')}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
              />
            )}
            {dictation.available && (
              <button
                className={isDictating ? 'button-quiet composer__mic composer__mic--on' : 'button-quiet composer__mic'}
                type="button"
                aria-pressed={isDictating}
                disabled={isSending}
                onClick={() => {
                  if (isDictating) {
                    void dictation.stop()
                  } else {
                    provisionalRef.current = null
                    void dictation.start()
                  }
                }}
              >
                {isDictating ? t('chat.dictation.stop') : t('chat.dictation.start')}
              </button>
            )}
            <button
              className="button"
              type="submit"
              disabled={isSending || (!draft.trim() && !isDictating)}
            >
              {t('chat.send')}
            </button>
          </div>
          <p className="visually-hidden" role="status">
            {dictation.status === 'listening' ? t('chat.dictation.listening') : ''}
          </p>
          <p className="chat__notice">{t('chat.notice')}</p>
        </form>
      ) : (
        <p className="chat__notice">{t('case.readOnly')}</p>
      )}
    </div>
  )
}

export default ChatPanel
