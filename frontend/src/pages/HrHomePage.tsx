import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../api/client.ts'
import { getMyCompany, saveMyCompany, type CompanyInput, type OwnCompany } from '../api/hr.ts'
import IncidentDashboard from '../components/hr/IncidentDashboard.tsx'
import JobOfferReview from '../components/hr/JobOfferReview.tsx'

const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'] as const

function fieldError(error: unknown, field: string): string | undefined {
  if (!(error instanceof ApiError) || error.status !== 400) return undefined
  const value = (error.data as Record<string, unknown> | null)?.[field]
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined
}

function CompanyForm({ company, onDone }: { company: OwnCompany | null; onDone?: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<CompanyInput>({
    name: company?.name ?? '',
    province: company?.province ?? 'AB',
    city: company?.city ?? '',
  })
  const ids = { name: useId(), province: useId(), city: useId() }
  const save = useMutation({
    mutationFn: () => saveMyCompany(form),
    onSuccess: (saved) => {
      queryClient.setQueryData(['hr', 'company'], saved)
      void queryClient.invalidateQueries({ queryKey: ['hr', 'dashboard'] })
      onDone?.()
    },
  })
  const renaming = company?.is_verified && form.name.trim() !== company.name

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    save.mutate()
  }

  return (
    <form className="form company-form" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor={ids.name}>{t('hrCompany.name')}</label>
        <input
          id={ids.name}
          required
          maxLength={200}
          value={form.name}
          aria-invalid={Boolean(fieldError(save.error, 'name'))}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        {fieldError(save.error, 'name') && <span className="form-error">{fieldError(save.error, 'name')}</span>}
        {renaming && <span className="field-hint">{t('hrCompany.renameWarning')}</span>}
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor={ids.province}>{t('hrCompany.province')}</label>
          <select
            id={ids.province}
            value={form.province}
            onChange={(e) => setForm({ ...form, province: e.target.value })}
          >
            {PROVINCES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.city}>{t('hrCompany.city')}</label>
          <input
            id={ids.city}
            maxLength={100}
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
          />
        </div>
      </div>
      {save.isError && !fieldError(save.error, 'name') && (
        <p className="form-error" role="alert">
          {t('common.serverError')}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="button" disabled={save.isPending}>
          {company ? t('hrCompany.save') : t('hrCompany.create')}
        </button>
        {onDone && (
          <button type="button" className="button-quiet" onClick={onDone}>
            {t('common.cancel')}
          </button>
        )}
      </div>
    </form>
  )
}

function CompanyStatus({ company }: { company: OwnCompany }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  if (editing) return <CompanyForm company={company} onDone={() => setEditing(false)} />
  return (
    <div className="profile-summary">
      <div className={`status-banner status-banner--${company.is_verified ? 'listed' : 'pending'}`}>
        <strong>
          {company.name}
          {company.city ? ` · ${company.city}` : ''} · {company.province}
        </strong>
        <span>{company.is_verified ? t('hrCompany.verified') : t('hrCompany.pending')}</span>
      </div>
      <button type="button" className="button-quiet" onClick={() => setEditing(true)}>
        {t('hrCompany.edit')}
      </button>
    </div>
  )
}

function HrHomePage() {
  const { t } = useTranslation()
  const { data: company, isLoading, isError } = useQuery({ queryKey: ['hr', 'company'], queryFn: getMyCompany })
  const title = t('partnerHome.hr.title')

  return (
    <>
      <title>{`${title} · ${t('app.name')}`}</title>
      <p className="eyebrow">{t('partnerHome.hr.eyebrow')}</p>
      <h1>{title}</h1>
      <p className="page-description">{t('partnerHome.hr.description')}</p>

      {isLoading && <p role="status">{t('common.loading')}</p>}
      {isError && (
        <p className="form-error" role="alert">
          {t('common.serverError')}
        </p>
      )}
      {company === null && (
        <section className="partner-section" aria-labelledby="company-title">
          <h2 id="company-title" className="section-title">
            {t('hrCompany.setupTitle')}
          </h2>
          <p>{t('hrCompany.setupText')}</p>
          <CompanyForm company={null} />
        </section>
      )}
      {company && <CompanyStatus company={company} />}

      {company?.is_verified && (
        <>
          <section className="partner-section" aria-labelledby="reports-title">
            <h2 id="reports-title" className="section-title">
              {t('hrDashboard.title')}
            </h2>
            <IncidentDashboard />
          </section>
          <section className="partner-section" aria-labelledby="offers-title">
            <h2 id="offers-title" className="section-title">
              {t('jobOffers.sectionTitle')}
            </h2>
            <p className="page-description">{t('jobOffers.description')}</p>
            <JobOfferReview />
          </section>
        </>
      )}
    </>
  )
}

export default HrHomePage
