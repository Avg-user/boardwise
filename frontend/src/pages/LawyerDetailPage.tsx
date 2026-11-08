import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useParams } from 'react-router-dom'
import { listCases } from '../api/cases.ts'
import { ApiError } from '../api/client.ts'
import { getFirm, listCaseMatches, requestMatch } from '../api/lawfirms.ts'
import Icon from '../components/Icon.tsx'
import { feeLines } from '../components/lawfirms/format.ts'
import NotFoundPage from './NotFoundPage.tsx'

const NOTE_LIMIT = 1000

function LawyerDetailPage() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const firmId = Number(useParams().firmId)
  const fromState: unknown = useLocation().state
  const backSearch =
    typeof fromState === 'object' && fromState !== null && 'directorySearch' in fromState
      ? String(fromState.directorySearch)
      : ''
  const firmQuery = useQuery({ queryKey: ['lawfirms', 'detail', firmId], queryFn: () => getFirm(firmId) })
  const casesQuery = useQuery({ queryKey: ['cases'], queryFn: listCases })
  const ownCases = (casesQuery.data ?? []).filter((item) => item.is_owner && item.status === 'open')
  const [caseId, setCaseId] = useState<number | null>(null)
  const selectedCase = caseId ?? ownCases[0]?.id ?? null
  const [note, setNote] = useState('')

  const matchesQuery = useQuery({
    queryKey: ['cases', selectedCase, 'matches'],
    queryFn: () => listCaseMatches(selectedCase as number),
    enabled: selectedCase !== null,
  })
  const existing = matchesQuery.data?.find(
    (match) => match.firm === firmId && ['pending', 'accepted'].includes(match.status),
  )

  const send = useMutation({
    mutationFn: () => requestMatch(selectedCase as number, firmId, note.trim()),
    onSuccess: () => {
      setNote('')
      void queryClient.invalidateQueries({ queryKey: ['cases', selectedCase, 'matches'] })
    },
  })

  if (firmQuery.error instanceof ApiError && firmQuery.error.status === 404) {
    return <NotFoundPage />
  }
  if (!firmQuery.data) {
    return firmQuery.isError ? (
      <p className="form-error" role="alert">
        {t('common.serverError')}
      </p>
    ) : (
      <p role="status">{t('common.loading')}</p>
    )
  }

  const firm = firmQuery.data
  const fees = feeLines(firm, t, i18n.resolvedLanguage)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (selectedCase !== null && !send.isPending) send.mutate()
  }

  return (
    <>
      <title>{`${firm.name} · ${t('app.name')}`}</title>
      {/* Back to the directory with the filters it had, when we came from there. */}
      <Link className="back-link" to={{ pathname: '/lawyers', search: backSearch }}>
        <Icon name="chevronLeft" />
        {t('lawyers.back')}
      </Link>
      <p className="eyebrow">{t('lawyers.verifiedFirm')}</p>
      <h1>{firm.name}</h1>
      {firm.tagline && <p className="page-description">{firm.tagline}</p>}

      <div className="firm-layout">
        <div className="firm-main">
          <section className="firm-section">
            <h2 className="section-title">{t('lawyers.about')}</h2>
            <p className="firm-description">{firm.description}</p>
            <div className="chips">
              {firm.practice_areas.map((area) => (
                <span key={area} className="chip">
                  {t(`lawyers.areas.${area}`)}
                </span>
              ))}
            </div>
          </section>

          <section className="firm-section">
            <h2 className="section-title">{t('lawyers.feesTitle')}</h2>
            {fees.length > 0 ? (
              <ul className="fee-list">
                {fees.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="placeholder-notice">{t('lawyers.fees.ask')}</p>
            )}
            {firm.fee_notes && <p className="firm-notes">{firm.fee_notes}</p>}
          </section>

          <section className="firm-section">
            <h2 className="section-title">{t('lawyers.details')}</h2>
            <dl className="facts">
              {firm.city && (
                <>
                  <dt>{t('lawyers.city')}</dt>
                  <dd>{firm.city}</dd>
                </>
              )}
              <dt>{t('lawyers.provinces')}</dt>
              <dd>{firm.provinces.join(', ')}</dd>
              <dt>{t('lawyers.languagesLabel')}</dt>
              <dd>{firm.languages.map((code) => t(`lawyers.languages.${code}`)).join(', ')}</dd>
              {firm.years_in_practice !== null && (
                <>
                  <dt>{t('lawyers.experience')}</dt>
                  <dd>{t('lawyers.years', { count: firm.years_in_practice })}</dd>
                </>
              )}
              {firm.website && (
                <>
                  <dt>{t('lawyers.website')}</dt>
                  <dd>
                    <a href={firm.website} target="_blank" rel="noopener noreferrer">
                      {firm.website.replace(/^https?:\/\//, '')}
                      <span className="visually-hidden"> {t('common.opensInNewTab')}</span>
                    </a>
                  </dd>
                </>
              )}
            </dl>
          </section>
        </div>

        <aside className="connect-card" aria-labelledby="connect-title">
          <h2 id="connect-title">{t('lawyers.connect.title')}</h2>
          <p>{t('lawyers.connect.intro')}</p>
          {casesQuery.isSuccess && ownCases.length === 0 ? (
            <p className="placeholder-notice">{t('lawyers.connect.noCases')}</p>
          ) : existing ? (
            <p className="connect-status" role="status">
              {t(`lawyers.connect.status.${existing.status as 'pending' | 'accepted'}`)}
            </p>
          ) : send.isSuccess ? (
            <p className="connect-status" role="status">
              {t('lawyers.connect.sent')}
            </p>
          ) : (
            <form className="form" onSubmit={handleSubmit}>
              {ownCases.length > 1 && (
                <div className="field">
                  <label htmlFor="connect-case">{t('lawyers.connect.case')}</label>
                  <select
                    id="connect-case"
                    value={selectedCase ?? ''}
                    onChange={(event) => setCaseId(Number(event.target.value))}
                  >
                    {ownCases.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field">
                <label htmlFor="connect-note">{t('lawyers.connect.note')}</label>
                <span className="field-hint" id="connect-note-hint">
                  {t('lawyers.connect.noteHint')}
                </span>
                <textarea
                  id="connect-note"
                  rows={4}
                  maxLength={NOTE_LIMIT}
                  aria-describedby="connect-note-hint"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>
              <p className="connect-consent">{t('lawyers.connect.consent')}</p>
              {send.isError && (
                <p className="form-error" role="alert">
                  {t('common.serverError')}
                </p>
              )}
              <button className="button" type="submit" disabled={send.isPending || selectedCase === null}>
                {send.isPending ? t('lawyers.connect.sending') : t('lawyers.connect.send')}
              </button>
            </form>
          )}
        </aside>
      </div>
    </>
  )
}

export default LawyerDetailPage
