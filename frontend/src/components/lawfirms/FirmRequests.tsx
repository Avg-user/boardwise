import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { listFirmRequests, respondToRequest, type FirmRequest } from '../../api/lawfirms.ts'

/** Requests sent to this firm. Until the firm accepts, all it sees is the worker's note. */
function FirmRequests({ canAccept }: { canAccept: boolean }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['lawfirms', 'me', 'requests'],
    queryFn: listFirmRequests,
  })
  const respond = useMutation({
    mutationFn: ({ id, answer }: { id: number; answer: 'accept' | 'decline' }) =>
      respondToRequest(id, answer),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['lawfirms', 'me', 'requests'] })
      void queryClient.invalidateQueries({ queryKey: ['cases'] })
    },
  })
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium' })
  const pending = data?.filter((item) => item.status === 'pending') ?? []
  const answered = data?.filter((item) => item.status !== 'pending') ?? []

  function row(item: FirmRequest) {
    return (
      <li key={item.id} className="request-card">
        <div className="request-card__head">
          <span className="case-card__meta">{t('firmRequests.received', { date: date.format(new Date(item.created_at)) })}</span>
          <span className={`tag status--${item.status}`}>{t(`matches.status.${item.status}`)}</span>
        </div>
        <blockquote className="request-card__note">
          {item.message || <em>{t('firmRequests.noNote')}</em>}
        </blockquote>
        {item.status === 'pending' && (
          <div className="request-card__actions">
            <button
              type="button"
              className="button"
              disabled={!canAccept || respond.isPending}
              onClick={() => respond.mutate({ id: item.id, answer: 'accept' })}
            >
              {t('firmRequests.accept')}
            </button>
            <button
              type="button"
              className="button-quiet"
              disabled={respond.isPending}
              onClick={() => respond.mutate({ id: item.id, answer: 'decline' })}
            >
              {t('firmRequests.decline')}
            </button>
          </div>
        )}
        {item.case_id !== null && (
          <Link to={`/cases/${item.case_id}`}>{t('firmRequests.openCase', { title: item.case_title })}</Link>
        )}
      </li>
    )
  }

  return (
    <section className="partner-section" aria-labelledby="requests-title">
      <h2 id="requests-title" className="section-title">
        {t('firmRequests.title')}
      </h2>
      <p className="field-hint">{t('firmRequests.explain')}</p>
      {!canAccept && <p className="form-error">{t('firmRequests.mustBeVerified')}</p>}
      {isLoading && <p role="status">{t('common.loading')}</p>}
      {isError && (
        <p className="form-error" role="alert">
          {t('common.serverError')}
        </p>
      )}
      {respond.isError && (
        <p className="form-error" role="alert">
          {t('common.serverError')}
        </p>
      )}
      {data?.length === 0 && <p className="placeholder-notice">{t('firmRequests.empty')}</p>}
      {pending.length > 0 && <ul className="request-list">{pending.map(row)}</ul>}
      {answered.length > 0 && (
        <details className="answered">
          <summary>{t('firmRequests.answered', { count: answered.length })}</summary>
          <ul className="request-list">{answered.map(row)}</ul>
        </details>
      )}
    </section>
  )
}

export default FirmRequests
