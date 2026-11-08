import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { closeSession } from '../../api/closedSessions.ts'
import type { ChatMessage } from '../../api/types.ts'
import { OwlMark } from '../brand/Owl.tsx'
import ConfirmDialog from '../ConfirmDialog.tsx'
import { sendChatMessage, usePendingSend, type PendingSend } from './chatSending.ts'
import CrisisBanner from './CrisisBanner.tsx'
import Markdown from './Markdown.tsx'
import { NEW_SESSION, SESSION_PARAM, useConversation } from './useConversation.ts'
import { useDictation } from './useDictation.ts'
import { warmDictation } from '../../api/dictation.ts'

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
  /** Printed at the top of an exported transcript. */
  caseTitle: string
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

function ChatPanel({ caseId, caseTitle, canEdit }: ChatPanelProps) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const {
    conversationId,
    conversation,
    current,
    isNewChat,
    isCurrent,
    isClosed,
    messages,
    isLoading,
    isError,
  } = useConversation(caseId)
  const pending = usePendingSend(caseId)
  const [isConfirmingClose, setIsConfirmingClose] = useState(false)
  const [isConfirmingNew, setIsConfirmingNew] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportFailed, setExportFailed] = useState(false)
  const dateTimeFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  const sessionDate = conversation ? dateTimeFormat.format(new Date(conversation.created_at)) : ''
  const canExport = canEdit && conversation !== null && messages.length > 0
  const [draft, setDraftState] = useState('')
  // Mirrors `draft` without waiting for a render, so send() sees text dictated just before it.
  const draftRef = useRef('')
  const setDraft = useCallback((update: string | ((current: string) => string)) => {
    draftRef.current = typeof update === 'function' ? update(draftRef.current) : update
    setDraftState(draftRef.current)
  }, [])
  const [restoredFailure, setRestoredFailure] = useState<PendingSend | null>(null)
  const [dismissedCrisisId, setDismissedCrisisId] = useState<number | null>(null)
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
  // Load the speech model while the chat is open, so Speak starts at once.
  useEffect(() => {
    if (dictation.available) warmDictation()
  }, [dictation.available])
  const isDictating = dictation.status !== 'idle'
  const wasDictating = useRef(false)

  // A send keeps going if the person leaves; coming back shows it again.
  const isCaseBusy = pending?.status === 'sending'
  // Shown only in the chat it belongs to. A first message from a blank chat stays visible
  // there while the new chat is created and listed.
  const isSendingHere =
    isCaseBusy &&
    (pending.conversationId === conversationId || (pending.startedBlank && conversationId === null))
  const pendingText = isSendingHere ? pending.content : null
  const streamedText = isSendingHere ? pending.streamed : ''
  const latestCrisisId = messages.findLast((message) => message.flagged_crisis)?.id ?? null
  const showCrisisBanner =
    canEdit && latestCrisisId !== null && latestCrisisId !== dismissedCrisisId

  // A send that failed, even while the person was elsewhere, stays recorded until the next
  // send. Put its text back in the box once, so they can retry.
  const sendFailed = pending?.status === 'failed'
  if (sendFailed && pending !== restoredFailure) {
    setRestoredFailure(pending)
    // State only here: refs can't be written during render. The effect below syncs draftRef.
    setDraftState(pending.content)
  }

  // Keeps draftRef in step when the draft is set without setDraft, as just above.
  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  // Once a new chat exists on the server, point the URL at it, so a retry stays in it.
  useEffect(() => {
    if (isNewChat && pending?.conversationId != null) {
      navigate({ search: `?${SESSION_PARAM}=${pending.conversationId}` }, { replace: true })
    }
  }, [isNewChat, pending?.conversationId, navigate])

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
    if (isCaseBusy) {
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
    setDraft('')
    // Starting a new send replaces any failed one, which clears the error.
    void sendChatMessage({
      caseId,
      conversationId,
      content,
      language: i18n.resolvedLanguage ?? 'en',
      entryTitle: t('timeline.chatEntryTitle', {
        date: new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium' }).format(new Date()),
      }),
    })
  }

  async function confirmClose() {
    if (conversationId === null) return
    closeSession(conversationId)
    // Stay on this chat so the person sees it's now closed.
    navigate({ search: `?${SESSION_PARAM}=${conversationId}` }, { replace: true })
  }

  function openBlankChat() {
    navigate({ search: `?${SESSION_PARAM}=${NEW_SESSION}` })
  }

  /** Only one chat stays open per issue, so starting another closes the open one, after asking. */
  function requestNewChat() {
    if (current) {
      setIsConfirmingNew(true)
    } else {
      openBlankChat()
    }
  }

  async function confirmNewChat() {
    if (current) closeSession(current.id)
    openBlankChat()
  }

  async function exportTranscript() {
    if (!conversation) return
    setIsExporting(true)
    setExportFailed(false)
    try {
      const { downloadTranscript } = await import('../../export/transcriptPdf.ts')
      // A generic file name: the issue title could be sensitive in a downloads list.
      const day = conversation.created_at.slice(0, 10)
      await downloadTranscript(
        {
          caseTitle,
          startedAt: conversation.created_at,
          messages,
          formatDateTime: (iso) => dateTimeFormat.format(new Date(iso)),
          labels: {
            heading: t('transcript.heading'),
            issue: t('transcript.issue'),
            started: t('transcript.started'),
            exported: t('transcript.exported'),
            notice: t('transcript.notice'),
            you: t('transcript.you'),
            assistant: t('chat.aiLabel'),
            sources: t('chat.sources'),
            page: (page, total) => t('transcript.page', { page, total }),
          },
        },
        `boardwise-chat-${day}.pdf`,
      )
    } catch {
      setExportFailed(true)
    }
    setIsExporting(false)
  }

  const exportButton = canExport && (
    <button type="button" className="button-quiet" disabled={isExporting} onClick={exportTranscript}>
      {isExporting ? t('transcript.preparing') : t('transcript.download')}
    </button>
  )
  const exportError = exportFailed && (
    <p className="form-error" role="alert">
      {t('transcript.failed')}
    </p>
  )

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
      {!isCurrent && (
        <p className="session-notice">
          {t('chat.earlierSession', { date: sessionDate })}{' '}
          <Link to={{ search: '' }}>{t('chat.latestSession')}</Link>
        </p>
      )}
      {canEdit && conversationId !== null && !isClosed && (
        <div className="chat__toolbar">
          {messages.length > 0 && (
            <button
              type="button"
              className="button-quiet"
              disabled={isCaseBusy}
              onClick={requestNewChat}
            >
              {t('chat.newChatShort')}
            </button>
          )}
          {exportButton}
          <button
            type="button"
            className="button-quiet"
            disabled={isCaseBusy}
            onClick={() => setIsConfirmingClose(true)}
          >
            {t('chat.closeChat')}
          </button>
          <ConfirmDialog
            open={isConfirmingClose}
            onClose={() => setIsConfirmingClose(false)}
            title={t('chat.closeTitle')}
            message={t('chat.closeMessage')}
            confirmLabel={t('chat.closeChat')}
            pendingLabel={t('chat.closeChat')}
            onConfirm={confirmClose}
          />
        </div>
      )}
      {!isClosed && exportError}
      {canEdit && current && (
        <ConfirmDialog
          open={isConfirmingNew}
          onClose={() => setIsConfirmingNew(false)}
          title={t('chat.newChatTitle')}
          message={t('chat.newChatMessage', {
            date: dateTimeFormat.format(new Date(current.created_at)),
          })}
          confirmLabel={t('chat.newChatConfirm')}
          pendingLabel={t('chat.newChatConfirm')}
          onConfirm={confirmNewChat}
        />
      )}
      <div className="chat__log" role="log" aria-busy={isSendingHere} aria-label={t('chat.logLabel')}>
        {isLoading && <p role="status">{t('common.loading')}</p>}
        {isError && (
          <p className="form-error" role="alert">
            {t('common.serverError')}
          </p>
        )}
        {!isLoading && !isError && messages.length === 0 && !isSendingHere && (
          <div className="message message--assistant">
            <AssistantLabel />
            <p>{t('chat.intro')}</p>
          </div>
        )}
        {messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}
        {pendingText !== null && <p className="message message--user">{pendingText}</p>}
        {isSendingHere && (
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

      {canEdit && isClosed ? (
        // Replaces the message box, as other chat apps do for ended conversations.
        <div className="closed-bar">
          <p>{t('chat.closedBar')}</p>
          {exportError}
          <div className="closed-bar__actions">
            <button type="button" className="button" onClick={requestNewChat}>
              {t('chat.newChat')}
            </button>
            {exportButton}
          </div>
        </div>
      ) : canEdit ? (
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
                {dictation.status !== 'connecting' && (draft.trim() || dictation.partial) ? (
                  <>
                    {draft.trimEnd()}
                    {draft.trim() && dictation.partial ? ' ' : ''}
                    {dictation.partial && (
                      <span className="composer__partial">{dictation.partial}</span>
                    )}
                  </>
                ) : (
                  <>
                    {draft.trimEnd()}
                    {draft.trim() ? ' ' : ''}
                    <span className="composer__partial">
                      {dictation.status === 'connecting'
                        ? t('chat.dictation.connecting')
                        : t('chat.dictation.listening')}
                    </span>
                  </>
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
                onPointerEnter={warmDictation}
                disabled={isCaseBusy}
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
              disabled={isCaseBusy || (!draft.trim() && !isDictating)}
            >
              {t('chat.send')}
            </button>
          </div>
          <p className="visually-hidden" role="status">
            {dictation.status === 'listening'
              ? t('chat.dictation.listening')
              : dictation.status === 'connecting'
                ? t('chat.dictation.connecting')
                : ''}
          </p>
        </form>
      ) : (
        <p className="chat__notice">{t('case.readOnly')}</p>
      )}

      {/* Always at the bottom for the person writing. The crisis part steps aside while the
          full crisis banner is open, so the same numbers aren't shown twice. */}
      {canEdit && (
        <p className="chat__notice chat__footnote">
          <span>{t('chat.notice')}</span>
          {!showCrisisBanner && (
            <span className="chat__safety">
              {t('chat.safety.danger')} <a href="tel:911">{t('chat.safety.call911')}</a>
              {' · '}
              <a href="tel:988">{t('chat.safety.call988')}</a>
            </span>
          )}
        </p>
      )}
    </div>
  )
}

export default ChatPanel
