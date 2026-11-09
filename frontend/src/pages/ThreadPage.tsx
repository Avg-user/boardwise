import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../api/client.ts'
import { getThread, replyToThread, THREADS_KEY, UNREAD_KEY } from '../api/messages.ts'
import { useCurrentUser } from '../auth/useCurrentUser.ts'
import Icon from '../components/Icon.tsx'
import NotFoundPage from './NotFoundPage.tsx'

const MAX_LENGTH = 5000

/** One conversation between a worker and a firm. New replies show up while it's open. */
function ThreadPage() {
  const { t, i18n } = useTranslation()
  const { user } = useCurrentUser()
  const isFirm = user?.role === 'law_firm'
  const queryClient = useQueryClient()
  const id = Number(useParams().threadId)
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const thread = useQuery({
    queryKey: [...THREADS_KEY, id],
    queryFn: () => getThread(id),
    enabled: Number.isInteger(id) && id > 0,
    refetchInterval: 15_000,
  })
  const reply = useMutation({
    mutationFn: (body: string) => replyToThread(id, body),
    onSuccess: (updated) => {
      queryClient.setQueryData([...THREADS_KEY, id], updated)
      setDraft('')
      void queryClient.invalidateQueries({ queryKey: THREADS_KEY, exact: true })
    },
  })
  const count = thread.data?.messages.length ?? 0

  // Opening the thread marks it read on the server, so the nav badge needs a fresh count.
  useEffect(() => {
    if (thread.dataUpdatedAt) void queryClient.invalidateQueries({ queryKey: UNREAD_KEY })
  }, [thread.dataUpdatedAt, queryClient])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [count])

  if (thread.error instanceof ApiError && thread.error.status === 404) return <NotFoundPage />
  if (thread.isLoading) return <p role="status">{t('common.loading')}</p>
  if (!thread.data) {
    return (
      <p className="form-error" role="alert">
        {t('common.serverError')}
      </p>
    )
  }

  const data = thread.data
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium', timeStyle: 'short' })
  const other = isFirm ? t('messages.aWorker') : data.firm_name

  function send(event?: FormEvent) {
    event?.preventDefault()
    const body = draft.trim()
    if (body && !reply.isPending) reply.mutate(body)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl+Enter sends; plain Enter makes a new line, since messages here are often long.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) send()
  }

  return (
    <>
      <title>{`${data.subject} · ${t('app.name')}`}</title>
      <Link className="back-link" to="/messages">
        <Icon name="chevronLeft" />
        {t('messages.back')}
      </Link>
      <div className="thread-header">
        <h1>{data.subject}</h1>
        <p className="page-description">
          {isFirm ? t('messages.withWorker') : t('messages.withFirm', { firm: data.firm_name })}
          {!isFirm && (
            <>
              {' · '}
              <Link to={`/lawyers/${data.firm}`}>{t('messages.viewFirm')}</Link>
            </>
          )}
        </p>
      </div>

      <div className="chat-card thread">
        <ol className="thread__log" aria-label={t('messages.logLabel')}>
          {data.messages.map((message) => (
            <li key={message.id} className={`thread-message thread-message--${message.mine ? 'mine' : 'theirs'}`}>
              <span className="thread-message__meta">
                {message.mine ? t('messages.you') : other}
                {' · '}
                <time dateTime={message.created_at}>{date.format(new Date(message.created_at))}</time>
              </span>
              <p className="thread-message__body">{message.body}</p>
            </li>
          ))}
        </ol>
        <div ref={endRef} />
        {data.can_reply ? (
          <form className="composer-area" onSubmit={send}>
            {reply.isError && (
              <p className="form-error" role="alert">
                {t('messages.sendFailed')}
              </p>
            )}
            <div className="composer">
              <label className="visually-hidden" htmlFor="thread-reply">
                {t('messages.replyLabel')}
              </label>
              <textarea
                id="thread-reply"
                rows={2}
                maxLength={MAX_LENGTH}
                placeholder={t('messages.replyPlaceholder', { name: other })}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button
                className="button composer__send"
                type="submit"
                aria-label={t('messages.send')}
                title={t('messages.send')}
                disabled={reply.isPending || !draft.trim()}
              >
                <Icon name="arrowUp" />
              </button>
            </div>
          </form>
        ) : (
          <p className="chat__notice chat__readonly">{t('messages.cannotReply')}</p>
        )}
      </div>
      <p className="chat__notice chat__footnote">
        {isFirm ? t('messages.firmFootnote') : t('messages.workerFootnote')}
      </p>
    </>
  )
}

export default ThreadPage
