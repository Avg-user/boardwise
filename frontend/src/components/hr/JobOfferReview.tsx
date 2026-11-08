import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api/client.ts'
import {
  deleteJobOffer,
  getJobOffer,
  listJobOffers,
  retryJobOffer,
  submitJobOffer,
  type Finding,
  type JobOffer,
} from '../../api/hr.ts'
import ConfirmDialog from '../ConfirmDialog.tsx'

const ACCEPT = '.pdf,.docx,.txt,.md'
const POLL_MS = 3000

function isWorking(offer: Pick<JobOffer, 'status'>) {
  return offer.status === 'pending' || offer.status === 'processing'
}

function errorMessage(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.status !== 400) return null
  const data = error.data as Record<string, unknown> | null
  for (const value of Object.values(data ?? {})) {
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  }
  return null
}

function UploadForm({ onSubmitted }: { onSubmitted: (offer: JobOffer) => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'file' | 'text'>('file')
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const ids = { file: useId(), text: useId(), title: useId() }

  const submit = useMutation({
    mutationFn: () => submitJobOffer(mode === 'file' && file ? { file } : { text, title }),
    onSuccess: (offer) => {
      void queryClient.invalidateQueries({ queryKey: ['hr', 'job-offers'] })
      setFile(null)
      setText('')
      setTitle('')
      if (fileRef.current) fileRef.current.value = ''
      onSubmitted(offer)
    },
  })
  const ready = mode === 'file' ? file !== null : text.trim().length > 0

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (ready) submit.mutate()
  }

  return (
    <form className="form offer-form" onSubmit={handleSubmit}>
      <fieldset className="segmented">
        <legend className="visually-hidden">{t('jobOffers.inputMode')}</legend>
        <label>
          <input type="radio" name="offer-mode" checked={mode === 'file'} onChange={() => setMode('file')} />
          {t('jobOffers.upload')}
        </label>
        <label>
          <input type="radio" name="offer-mode" checked={mode === 'text'} onChange={() => setMode('text')} />
          {t('jobOffers.paste')}
        </label>
      </fieldset>

      {mode === 'file' ? (
        <div className="field">
          <label htmlFor={ids.file}>{t('jobOffers.file')}</label>
          <span className="field-hint">{t('jobOffers.fileHint')}</span>
          <input
            ref={fileRef}
            id={ids.file}
            type="file"
            accept={ACCEPT}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </div>
      ) : (
        <>
          <div className="field">
            <label htmlFor={ids.title}>{t('jobOffers.title')}</label>
            <input id={ids.title} value={title} maxLength={255} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={ids.text}>{t('jobOffers.text')}</label>
            <textarea id={ids.text} rows={8} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        </>
      )}

      {submit.isError && (
        <p className="form-error" role="alert">
          {errorMessage(submit.error) ?? t('common.serverError')}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="button" disabled={!ready || submit.isPending}>
          {submit.isPending ? t('jobOffers.sending') : t('jobOffers.check')}
        </button>
      </div>
      <p className="field-hint">{t('jobOffers.privacy')}</p>
    </form>
  )
}

function FindingItem({ finding }: { finding: Finding }) {
  const { t } = useTranslation()
  return (
    <li className={`finding finding--${finding.severity}`}>
      <span className="finding__severity">{t(`jobOffers.severity.${finding.severity}`)}</span>
      <h4 className="finding__title">{finding.title}</h4>
      {finding.offer_quote && <blockquote className="finding__quote">{finding.offer_quote}</blockquote>}
      {finding.explanation && <p>{finding.explanation}</p>}
      {finding.citation && <p className="finding__citation">{finding.citation}</p>}
    </li>
  )
}

function OfferDetail({ id, onDeleted }: { id: number; onDeleted: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const { data: offer, isError } = useQuery({
    queryKey: ['hr', 'job-offers', id],
    queryFn: () => getJobOffer(id),
    refetchInterval: (query) => (query.state.data && isWorking(query.state.data) ? POLL_MS : false),
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['hr', 'job-offers'] })
  const retry = useMutation({ mutationFn: () => retryJobOffer(id), onSuccess: refresh })
  const remove = useMutation({
    mutationFn: () => deleteJobOffer(id),
    onSuccess: () => {
      void refresh()
      onDeleted()
    },
  })

  if (isError) {
    return (
      <p className="form-error" role="alert">
        {t('common.serverError')}
      </p>
    )
  }
  if (!offer) return <p role="status">{t('common.loading')}</p>

  // Retrying can't fix the file itself; uploading it as text can.
  const fileProblem = offer.failure === 'no_text' || offer.failure === 'unreadable'
  const counts = (['violation', 'concern', 'info'] as const)
    .map((severity) => ({ severity, n: offer.findings.filter((f) => f.severity === severity).length }))
    .filter(({ n }) => n > 0)

  return (
    <article className="offer-detail" aria-labelledby={`offer-${id}`}>
      <div className="offer-detail__header">
        <h3 id={`offer-${id}`}>{offer.title}</h3>
        <div className="offer-detail__actions">
          {(offer.status === 'failed' || offer.failure === 'partial') && !fileProblem && (
            <button type="button" className="button-quiet" onClick={() => retry.mutate()} disabled={retry.isPending}>
              {t('jobOffers.retry')}
            </button>
          )}
          <button type="button" className="button-quiet" onClick={() => setConfirming(true)}>
            {t('jobOffers.delete')}
          </button>
        </div>
      </div>

      {isWorking(offer) && (
        <p className="session-notice" role="status">
          {t('jobOffers.working')}
        </p>
      )}
      {offer.status === 'failed' && (
        <p className="form-error" role="alert">
          {offer.failure === 'no_text'
            ? t('jobOffers.failedNoText')
            : offer.failure === 'unreadable'
              ? t('jobOffers.failedUnreadable')
              : t('jobOffers.failed')}
        </p>
      )}
      {offer.status === 'done' && (
        <>
          <p>
            <span className="ai-label">{t('jobOffers.aiLabel')}</span>
          </p>
          {offer.failure === 'partial' && (
            <p className="session-notice" role="status">
              {t('jobOffers.partial', {
                parts: offer.parts_unchecked.join(', '),
                count: offer.parts_unchecked.length,
                total: offer.parts_total,
              })}
            </p>
          )}
          {offer.summary
            .split(/\n\s*\n/)
            .filter(Boolean)
            .map((paragraph, index) => (
              <p key={index} className="offer-detail__summary">
                {paragraph}
              </p>
            ))}
          {counts.length > 0 && (
            <p className="chips" aria-label={t('jobOffers.countsLabel')}>
              {counts.map(({ severity, n }) => (
                <span key={severity} className={`chip finding-chip finding-chip--${severity}`}>
                  {t(`jobOffers.severityCount.${severity}`, { count: n })}
                </span>
              ))}
            </p>
          )}
          {offer.findings.length > 0 ? (
            <ul className="findings">
              {offer.findings.map((finding, index) => (
                <FindingItem key={index} finding={finding} />
              ))}
            </ul>
          ) : (
            <p>{t('jobOffers.noFindings')}</p>
          )}
          <p className="field-hint">{t('jobOffers.disclaimer')}</p>
        </>
      )}
      {offer.text && (
        <details className="offer-detail__text">
          <summary>{t('jobOffers.showText')}</summary>
          <pre>{offer.text}</pre>
        </details>
      )}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('jobOffers.deleteTitle')}
        message={t('jobOffers.deleteText')}
        confirmLabel={t('jobOffers.delete')}
        pendingLabel={t('jobOffers.deleting')}
        onConfirm={() => remove.mutateAsync()}
      />
    </article>
  )
}

function JobOfferReview() {
  const { t, i18n } = useTranslation()
  const [selected, setSelected] = useState<number | null>(null)
  const { data: offers, isLoading, isError } = useQuery({
    queryKey: ['hr', 'job-offers'],
    queryFn: listJobOffers,
    refetchInterval: (query) => (query.state.data?.some(isWorking) ? POLL_MS : false),
  })
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium' })
  const current = selected ?? offers?.[0]?.id ?? null

  return (
    <div className="offers-layout">
      <div className="offers-layout__side">
        <UploadForm onSubmitted={(offer) => setSelected(offer.id)} />
        {isLoading && <p role="status">{t('common.loading')}</p>}
        {isError && (
          <p className="form-error" role="alert">
            {t('common.serverError')}
          </p>
        )}
        {offers && offers.length > 0 && (
          <ul className="offer-list" aria-label={t('jobOffers.listLabel')}>
            {offers.map((offer) => (
              <li key={offer.id}>
                <button
                  type="button"
                  className="offer-list__item"
                  aria-current={offer.id === current}
                  onClick={() => setSelected(offer.id)}
                >
                  <span className="offer-list__title">{offer.title}</span>
                  <span className="offer-list__meta">
                    {date.format(new Date(offer.created_at))} · {t(`jobOffers.status.${offer.status}`)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="offers-layout__main">
        {current !== null ? (
          <OfferDetail key={current} id={current} onDeleted={() => setSelected(null)} />
        ) : (
          !isLoading && <p className="placeholder-notice">{t('jobOffers.empty')}</p>
        )}
      </div>
    </div>
  )
}

export default JobOfferReview
