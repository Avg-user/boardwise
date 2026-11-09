import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import {
  getOverview,
  listStaffCompanies,
  listStaffFirms,
  setVerified,
  type StaffCompany,
  type StaffFirm,
  type StaffKind,
  type VerifyStatus,
} from '../api/staff.ts'
import ConfirmDialog from '../components/ConfirmDialog.tsx'
import Icon from '../components/Icon.tsx'

const STATUSES: VerifyStatus[] = ['pending', 'verified', 'all']

function useDates() {
  const { i18n } = useTranslation()
  return new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium' })
}

/** Verify / remove verification, with a confirmation before taking it away. */
function VerifyActions({ kind, id, name, verified }: { kind: StaffKind; id: number; name: string; verified: boolean }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const change = useMutation({
    mutationFn: (next: boolean) => setVerified(kind, id, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff'] }),
  })

  return (
    <div className="review-card__actions">
      {verified ? (
        <button type="button" className="button button--secondary" onClick={() => setConfirming(true)}>
          {t('staff.unverify')}
        </button>
      ) : (
        <button type="button" className="button" disabled={change.isPending} onClick={() => change.mutate(true)}>
          <Icon name="check" />
          {t('staff.verify')}
        </button>
      )}
      {change.isError && (
        <p className="form-error" role="alert">
          {t('common.serverError')}
        </p>
      )}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('staff.unverifyTitle', { name })}
        message={t(kind === 'firms' ? 'staff.unverifyFirm' : 'staff.unverifyCompany')}
        confirmLabel={t('staff.unverify')}
        pendingLabel={t('staff.working')}
        onConfirm={() => change.mutateAsync(false)}
      />
    </div>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

function StatusLine({ item }: { item: StaffFirm | StaffCompany }) {
  const { t } = useTranslation()
  const date = useDates()
  return (
    <span className={`status-pill status-pill--${item.is_verified ? 'open' : 'waiting'}`}>
      {item.is_verified
        ? item.verified_at
          ? t('staff.verifiedOn', { date: date.format(new Date(item.verified_at)), by: item.verified_by ?? '—' })
          : t('staff.verified')
        : t('staff.waiting')}
    </span>
  )
}

function FirmCard({ firm }: { firm: StaffFirm }) {
  const { t } = useTranslation()
  const date = useDates()
  return (
    <li className="review-card">
      <div className="review-card__head">
        <div>
          <h3>{firm.name || t('staff.noName')}</h3>
          <p className="review-card__sub">
            {t('staff.signedUp', { date: date.format(new Date(firm.created_at)), account: firm.account })}
          </p>
        </div>
        <StatusLine item={firm} />
      </div>
      <dl className="facts review-card__facts">
        <Fact label={t('staff.lawSociety')}>
          <strong className="review-card__key">{firm.law_society_number || '—'}</strong>
        </Fact>
        <Fact label={t('staff.where')}>{[firm.city, firm.provinces.join(', ')].filter(Boolean).join(' · ') || '—'}</Fact>
        <Fact label={t('staff.email')}>{firm.email || '—'}</Fact>
        <Fact label={t('staff.phone')}>{firm.phone || '—'}</Fact>
        <Fact label={t('staff.website')}>
          {firm.website ? (
            <a href={firm.website} target="_blank" rel="noopener noreferrer">
              {firm.website.replace(/^https?:\/\//, '')}
              <span className="visually-hidden"> {t('common.opensInNewTab')}</span>
            </a>
          ) : (
            '—'
          )}
        </Fact>
        <Fact label={t('staff.inDirectory')}>
          {firm.is_listed ? t('staff.listed') : firm.accepting_clients ? t('staff.notListed') : t('staff.notAccepting')}
        </Fact>
      </dl>
      {firm.missing.length > 0 && (
        <p className="review-card__warning">
          {t('staff.missing', { fields: firm.missing.map((field) => t(`staff.fields.${field as 'description' | 'law_society_number'}`)).join(', ') })}
        </p>
      )}
      <VerifyActions kind="firms" id={firm.id} name={firm.name} verified={firm.is_verified} />
    </li>
  )
}

function CompanyCard({ company }: { company: StaffCompany }) {
  const { t } = useTranslation()
  const date = useDates()
  return (
    <li className="review-card">
      <div className="review-card__head">
        <div>
          <h3>{company.name}</h3>
          <p className="review-card__sub">{t('staff.created', { date: date.format(new Date(company.created_at)) })}</p>
        </div>
        <StatusLine item={company} />
      </div>
      <dl className="facts review-card__facts">
        <Fact label={t('staff.where')}>{[company.city, company.province].filter(Boolean).join(', ')}</Fact>
        <Fact label={t('staff.hrAccounts')}>
          <strong className="review-card__key">{company.hr_accounts.join(', ') || '—'}</strong>
        </Fact>
      </dl>
      <VerifyActions kind="companies" id={company.id} name={company.name} verified={company.is_verified} />
    </li>
  )
}

function ReviewList({ kind, status, q }: { kind: StaffKind; status: VerifyStatus; q: string }) {
  const { t } = useTranslation()
  const firms = useQuery({
    queryKey: ['staff', 'firms', status, q],
    queryFn: () => listStaffFirms(status, q),
    enabled: kind === 'firms',
    placeholderData: (previous) => previous,
  })
  const companies = useQuery({
    queryKey: ['staff', 'companies', status, q],
    queryFn: () => listStaffCompanies(status, q),
    enabled: kind === 'companies',
    placeholderData: (previous) => previous,
  })
  const active = kind === 'firms' ? firms : companies

  if (active.isLoading) return <p role="status">{t('common.loading')}</p>
  if (active.isError) {
    return (
      <p className="form-error" role="alert">
        {t('common.serverError')}
      </p>
    )
  }
  const count = kind === 'firms' ? (firms.data?.length ?? 0) : (companies.data?.length ?? 0)
  if (count === 0) {
    return (
      <div className="empty-state">
        <p>{status === 'pending' ? t('staff.allDone') : t('staff.none')}</p>
      </div>
    )
  }
  return (
    <ul className="review-list">
      {kind === 'firms'
        ? firms.data?.map((firm) => <FirmCard key={firm.id} firm={firm} />)
        : companies.data?.map((company) => <CompanyCard key={company.id} company={company} />)}
    </ul>
  )
}

/** Boardwise staff: verify law firms and HR companies before they're listed or see anything. */
function StaffPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const kind: StaffKind = params.get('tab') === 'companies' ? 'companies' : 'firms'
  const status = (STATUSES.find((s) => s === params.get('status')) ?? 'pending') as VerifyStatus
  const [q, setQ] = useState('')
  const overview = useQuery({ queryKey: ['staff', 'overview'], queryFn: getOverview })
  const title = t('staff.title')

  function update(next: Record<string, string>) {
    setParams({ tab: kind, status, ...next }, { replace: true })
  }

  const o = overview.data
  return (
    <>
      <title>{`${title} · ${t('app.name')}`}</title>
      <p className="eyebrow">{t('staff.eyebrow')}</p>
      <h1>{title}</h1>
      <p className="page-description">{t('staff.description')}</p>

      {o && (
        <dl className="stat-tiles staff-stats">
          <div className={`stat-tile${o.firms.pending ? ' stat-tile--attention' : ''}`}>
            <dt>{t('staff.firmsWaiting')}</dt>
            <dd>{o.firms.pending}</dd>
          </div>
          <div className={`stat-tile${o.companies.pending ? ' stat-tile--attention' : ''}`}>
            <dt>{t('staff.companiesWaiting')}</dt>
            <dd>{o.companies.pending}</dd>
          </div>
          <div className="stat-tile stat-tile--list">
            <dt>{t('staff.verifiedTotals')}</dt>
            <dd>
              <span>{t('staff.count.firms', { count: o.firms.verified })}</span>
              <span>{t('staff.count.companies', { count: o.companies.verified })}</span>
            </dd>
          </div>
          <div className="stat-tile stat-tile--list">
            <dt>{t('staff.accounts')}</dt>
            <dd>
              <span>{t('staff.count.workers', { count: o.accounts.victim })}</span>
              <span>{t('staff.count.hr', { count: o.accounts.hr })}</span>
              <span>{t('staff.count.firms', { count: o.accounts.law_firm })}</span>
            </dd>
          </div>
        </dl>
      )}

      <div className="staff-tabs" role="group" aria-label={t('staff.tabsLabel')}>
        {(['firms', 'companies'] as const).map((tab) => {
          const waiting = tab === 'firms' ? o?.firms.pending : o?.companies.pending
          return (
            <button
              key={tab}
              type="button"
              aria-pressed={kind === tab}
              onClick={() => {
                setQ('')
                update({ tab })
              }}
            >
              {t(`staff.tab.${tab}`)}
              {Boolean(waiting) && <span className="nav-badge">{waiting}</span>}
            </button>
          )
        })}
      </div>

      <section aria-label={t(`staff.tab.${kind}`)} className="staff-panel">
        <p className="field-hint staff-hint">{t(kind === 'firms' ? 'staff.firmHint' : 'staff.companyHint')}</p>
        <div className="staff-toolbar">
          <fieldset className="segmented">
            <legend className="visually-hidden">{t('staff.statusLabel')}</legend>
            {STATUSES.map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="staff-status"
                  checked={status === value}
                  onChange={() => update({ status: value })}
                />
                {t(`staff.status.${value}`)}
              </label>
            ))}
          </fieldset>
          <div className="field staff-search">
            <label className="visually-hidden" htmlFor="staff-search">
              {t('staff.search')}
            </label>
            <input
              id="staff-search"
              type="search"
              placeholder={t(kind === 'firms' ? 'staff.searchFirms' : 'staff.searchCompanies')}
              value={q}
              onChange={(event) => setQ(event.target.value)}
            />
          </div>
        </div>
        <ReviewList kind={kind} status={status} q={q} />
      </section>
    </>
  )
}

export default StaffPage
