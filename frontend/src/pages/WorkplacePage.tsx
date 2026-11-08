import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../api/client.ts'
import {
  getWorkplace,
  INCIDENT_CATEGORIES,
  leaveWorkplace,
  listCompanies,
  saveWorkplace,
  sendIncidentReport,
  type IncidentCategory,
  type Workplace,
} from '../api/hr.ts'
import ConfirmDialog from '../components/ConfirmDialog.tsx'

const WORKPLACE_KEY = ['workplace'] as const

function thisMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function monthsAgo(n: number): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function CompanyPicker({ onPicked, onCancel }: { onPicked: () => void; onCancel?: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [q, setQ] = useState('')
  const [choice, setChoice] = useState<number | null>(null)
  const searchId = useId()
  const { data: companies, isLoading } = useQuery({
    queryKey: ['companies', q.trim()],
    queryFn: () => listCompanies(q),
    placeholderData: (previous) => previous,
  })
  const save = useMutation({
    // Switching company always starts with reporting off, so the worker opts in knowingly.
    mutationFn: () => saveWorkplace({ company: choice, reporting_opt_in: false }),
    onSuccess: (saved) => {
      queryClient.setQueryData(WORKPLACE_KEY, saved)
      onPicked()
    },
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (choice !== null) save.mutate()
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor={searchId}>{t('workplace.search')}</label>
        <input id={searchId} type="search" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {isLoading && <p role="status">{t('common.loading')}</p>}
      {companies && companies.length === 0 && <p className="placeholder-notice">{t('workplace.noResults')}</p>}
      {companies && companies.length > 0 && (
        <fieldset className="field">
          <legend>{t('workplace.choose')}</legend>
          <div className="choice-list company-choices">
            {companies.map((company) => (
              <label key={company.id} className="choice">
                <input
                  type="radio"
                  name="company"
                  checked={choice === company.id}
                  onChange={() => setChoice(company.id)}
                />
                <span className="choice__label">
                  {company.name}
                  <span className="field-hint">
                    {[company.city, company.province].filter(Boolean).join(', ')}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <p className="field-hint">{t('workplace.notListed')}</p>
      {save.isError && (
        <p className="form-error" role="alert">
          {t('common.serverError')}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="button" disabled={choice === null || save.isPending}>
          {t('workplace.save')}
        </button>
        {onCancel && (
          <button type="button" className="button-quiet" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        )}
      </div>
    </form>
  )
}

function ReportForm() {
  const { t } = useTranslation()
  const [category, setCategory] = useState<IncidentCategory | ''>('')
  const [month, setMonth] = useState(thisMonth())
  const [ongoing, setOngoing] = useState(false)
  const [sent, setSent] = useState(false)
  const ids = { category: useId(), month: useId() }
  const send = useMutation({
    mutationFn: () => sendIncidentReport({ category: category as IncidentCategory, occurred_month: month, ongoing }),
    onSuccess: () => {
      setSent(true)
      setCategory('')
      setMonth(thisMonth())
      setOngoing(false)
    },
  })
  const limited = send.error instanceof ApiError && send.error.status === 429

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSent(false)
    if (category) send.mutate()
  }

  return (
    <form className="form report-form" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor={ids.category}>{t('workplace.category')}</label>
        <select
          id={ids.category}
          required
          value={category}
          onChange={(e) => setCategory(e.target.value as IncidentCategory)}
        >
          <option value="" disabled>
            {t('workplace.chooseCategory')}
          </option>
          {INCIDENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`incidentCategories.${c}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={ids.month}>{t('workplace.month')}</label>
        <span className="field-hint">{t('workplace.monthHint')}</span>
        <input
          id={ids.month}
          type="month"
          required
          min={monthsAgo(24)}
          max={thisMonth()}
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </div>
      <label className="choice">
        <input type="checkbox" checked={ongoing} onChange={(e) => setOngoing(e.target.checked)} />
        <span className="choice__label">{t('workplace.ongoing')}</span>
      </label>
      {sent && (
        <p className="form-success" role="status">
          {t('workplace.sent')}
        </p>
      )}
      {send.isError && (
        <p className="form-error" role="alert">
          {limited ? t('workplace.limit') : t('common.serverError')}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="button" disabled={!category || send.isPending}>
          {t('workplace.send')}
        </button>
      </div>
    </form>
  )
}

function Membership({ workplace }: { workplace: Workplace }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [changing, setChanging] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const optIn = useMutation({
    mutationFn: (value: boolean) => saveWorkplace({ reporting_opt_in: value }),
    onSuccess: (saved) => queryClient.setQueryData(WORKPLACE_KEY, saved),
  })

  if (changing) return <CompanyPicker onPicked={() => setChanging(false)} onCancel={() => setChanging(false)} />

  return (
    <>
      <div className="profile-summary">
        <div className="status-banner status-banner--listed">
          <strong>{workplace.company_name}</strong>
          <span>{t('workplace.yourCompany')}</span>
        </div>
        <button type="button" className="button-quiet" onClick={() => setChanging(true)}>
          {t('workplace.change')}
        </button>
        <button type="button" className="button-quiet" onClick={() => setLeaving(true)}>
          {t('workplace.leave')}
        </button>
      </div>

      <section className="case-section" aria-labelledby="optin-title">
        <h2 id="optin-title">{t('workplace.optInTitle')}</h2>
        <ul className="privacy-points">
          <li>{t('workplace.privacy1')}</li>
          <li>{t('workplace.privacy2')}</li>
          <li>{t('workplace.privacy3')}</li>
        </ul>
        <label className="choice">
          <input
            type="checkbox"
            checked={workplace.reporting_opt_in}
            disabled={optIn.isPending}
            onChange={(e) => optIn.mutate(e.target.checked)}
          />
          <span className="choice__label">{t('workplace.optIn', { company: workplace.company_name })}</span>
        </label>
        {optIn.isError && (
          <p className="form-error" role="alert">
            {t('common.serverError')}
          </p>
        )}
      </section>

      {workplace.reporting_opt_in && (
        <section className="case-section" aria-labelledby="report-title">
          <h2 id="report-title">{t('workplace.reportTitle')}</h2>
          <p className="page-description">{t('workplace.reportText')}</p>
          <ReportForm />
        </section>
      )}

      <ConfirmDialog
        open={leaving}
        onClose={() => setLeaving(false)}
        title={t('workplace.leaveTitle')}
        message={t('workplace.leaveText')}
        confirmLabel={t('workplace.leave')}
        pendingLabel={t('workplace.leaving')}
        onConfirm={async () => {
          await leaveWorkplace()
          await queryClient.invalidateQueries({ queryKey: WORKPLACE_KEY })
        }}
      />
    </>
  )
}

function WorkplacePage() {
  const { t } = useTranslation()
  const { data: workplace, isLoading, isError } = useQuery({ queryKey: WORKPLACE_KEY, queryFn: getWorkplace })
  const title = t('workplace.title')

  return (
    <>
      <title>{`${title} · ${t('app.name')}`}</title>
      <p className="eyebrow">{t('workplace.eyebrow')}</p>
      <h1>{title}</h1>
      <p className="page-description">{t('workplace.description')}</p>
      {isLoading && <p role="status">{t('common.loading')}</p>}
      {isError && (
        <p className="form-error" role="alert">
          {t('common.serverError')}
        </p>
      )}
      {workplace && workplace.company === null && <CompanyPicker onPicked={() => undefined} />}
      {workplace && workplace.company !== null && <Membership workplace={workplace} />}
    </>
  )
}

export default WorkplacePage
