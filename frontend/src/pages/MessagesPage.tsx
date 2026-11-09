import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { listThreads, THREADS_KEY } from '../api/messages.ts'
import { useCurrentUser } from '../auth/useCurrentUser.ts'
import Icon from '../components/Icon.tsx'

/** Conversations between workers and law firms, newest first. Same page for both sides. */
function MessagesPage() {
  const { t, i18n } = useTranslation()
  const { user } = useCurrentUser()
  const isFirm = user?.role === 'law_firm'
  const { data: threads, isLoading, isError } = useQuery({
    queryKey: THREADS_KEY,
    queryFn: listThreads,
    refetchInterval: 30_000,
  })
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium', timeStyle: 'short' })
  const title = t('messages.title')

  return (
    <>
      <title>{`${title} · ${t('app.name')}`}</title>
      <div className="page-header">
        <div>
          <h1>{title}</h1>
          <p className="page-description">{isFirm ? t('messages.firmDescription') : t('messages.description')}</p>
        </div>
        {!isFirm && (
          <Link className="button button--secondary" to="/lawyers">
            {t('messages.findFirm')}
          </Link>
        )}
      </div>

      {isLoading && <p role="status">{t('common.loading')}</p>}
      {isError && (
        <p className="form-error" role="alert">
          {t('common.serverError')}
        </p>
      )}
      {threads?.length === 0 && (
        <div className="empty-state">
          <p>{isFirm ? t('messages.emptyFirm') : t('messages.empty')}</p>
        </div>
      )}
      {threads && threads.length > 0 && (
        <ul className="thread-list">
          {threads.map((thread) => (
            <li key={thread.id}>
              <Link className="thread-card" to={`/messages/${thread.id}`} data-unread={thread.unread}>
                <span className="thread-card__top">
                  <span className="thread-card__who">
                    {thread.unread && <span className="unread-dot" aria-hidden="true" />}
                    {isFirm ? t('messages.aWorker') : thread.firm_name}
                    {thread.unread && <span className="visually-hidden"> ({t('messages.unread')})</span>}
                  </span>
                  <time className="thread-card__date" dateTime={thread.last_message_at}>
                    {date.format(new Date(thread.last_message_at))}
                  </time>
                </span>
                <span className="thread-card__subject">{thread.subject}</span>
                {thread.last_message && (
                  <span className="thread-card__preview">
                    {thread.last_message.mine && `${t('messages.you')}: `}
                    {thread.last_message.preview}
                  </span>
                )}
                <Icon name="chevronRight" className="thread-card__arrow" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

export default MessagesPage
