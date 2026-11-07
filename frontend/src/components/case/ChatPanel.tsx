import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { createConversation, sendMessage } from '../../api/chat.ts'
import type { ChatMessage } from '../../api/types.ts'
import CrisisBanner from './CrisisBanner.tsx'
import { conversationsQuery, messagesQuery, useConversation } from './useConversation.ts'

type ChatPanelProps = {
  caseId: number
  canEdit: boolean
}

function AssistantLabel() {
  const { t } = useTranslation()
  return <span className="ai-label">{t('chat.aiLabel')}</span>
}

function Message({ message }: { message: ChatMessage }) {
  const { t } = useTranslation()

  if (message.role === 'user') {
    return <p className="message message--user">{message.content}</p>
  }
  return (
    <div className="message message--assistant">
      <AssistantLabel />
      <p>{message.content}</p>
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
  const { conversationId, messages, isLoading, isError } = useConversation(caseId)
  const [draft, setDraft] = useState('')
  const [pendingText, setPendingText] = useState<string | null>(null)
  const [streamedText, setStreamedText] = useState('')
  const [sendFailed, setSendFailed] = useState(false)
  const [dismissedCrisisId, setDismissedCrisisId] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const crisisRef = useRef<HTMLDivElement>(null)

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

  async function send() {
    const content = draft.trim()
    if (!content || isSending) {
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
          <div className="composer">
            <label className="visually-hidden" htmlFor="chat-message">
              {t('chat.messageLabel')}
            </label>
            <textarea
              id="chat-message"
              rows={1}
              placeholder={t('chat.placeholder')}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button className="button" type="submit" disabled={isSending || !draft.trim()}>
              {t('chat.send')}
            </button>
          </div>
          <p className="chat__notice">{t('chat.notice')}</p>
        </form>
      ) : (
        <p className="chat__notice">{t('case.readOnly')}</p>
      )}
    </div>
  )
}

export default ChatPanel
