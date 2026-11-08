import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ApiError } from '../api/client.ts'
import {
  getMyProfile,
  LANGUAGES,
  PRACTICE_AREAS,
  saveMyProfile,
  type LanguageCode,
  type LawFirmInput,
  type OwnLawFirm,
  type PracticeArea,
} from '../api/lawfirms.ts'
import Icon from '../components/Icon.tsx'

const EMPTY: LawFirmInput = {
  name: '',
  tagline: '',
  description: '',
  practice_areas: [],
  languages: ['en'],
  provinces: ['AB'],
  city: '',
  years_in_practice: null,
  free_consultation: false,
  consultation_fee: null,
  hourly_rate_min: null,
  hourly_rate_max: null,
  flat_fee_from: null,
  contingency_percent: null,
  sliding_scale: false,
  legal_aid: false,
  fee_notes: '',
  website: '',
  email: '',
  phone: '',
  law_society_number: '',
  accepting_clients: true,
}

function toInput(profile: OwnLawFirm): LawFirmInput {
  const { id: _id, is_verified: _v, verified_at: _va, is_listed: _l, ...input } = profile
  return input
}

function firstError(data: unknown, field: string): string | undefined {
  const value = (data as Record<string, unknown> | null)?.[field]
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

type MoneyField = 'consultation_fee' | 'hourly_rate_min' | 'hourly_rate_max' | 'flat_fee_from'

function ProfileForm({ initial }: { initial: OwnLawFirm | null }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<LawFirmInput>(initial ? toInput(initial) : EMPTY)
  const save = useMutation({
    mutationFn: () => saveMyProfile(form),
    onSuccess: (saved) => queryClient.setQueryData(['lawfirms', 'me'], saved),
  })
  const errors = save.error instanceof ApiError && save.error.status === 400 ? save.error.data : null
  const hasFieldErrors = errors !== null && errors !== undefined
  const set = <K extends keyof LawFirmInput>(key: K, value: LawFirmInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  function moneyInput(field: MoneyField, label: string) {
    const error = firstError(errors, field)
    return (
      <div className="field">
        <label htmlFor={`firm-${field}`}>{label}</label>
        <input
          id={`firm-${field}`}
          type="number"
          min="0"
          step="1"
          inputMode="decimal"
          value={form[field] ?? ''}
          aria-invalid={Boolean(error)}
          onChange={(event) => set(field, event.target.value === '' ? null : event.target.value)}
        />
        {error && <span className="form-error">{error}</span>}
      </div>
    )
  }

  function textInput(
    field: 'name' | 'tagline' | 'city' | 'website' | 'email' | 'phone' | 'law_society_number',
    label: string,
    options: { required?: boolean; hint?: string; type?: string } = {},
  ) {
    const error = firstError(errors, field)
    return (
      <div className="field">
        <label htmlFor={`firm-${field}`}>{label}</label>
        {options.hint && <span className="field-hint">{options.hint}</span>}
        <input
          id={`firm-${field}`}
          type={options.type ?? 'text'}
          required={options.required}
          value={form[field]}
          aria-invalid={Boolean(error)}
          onChange={(event) => set(field, event.target.value)}
        />
        {error && <span className="form-error">{error}</span>}
      </div>
    )
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    save.mutate()
  }

  return (
    <form className="form profile-form" onSubmit={handleSubmit}>
      <fieldset className="form-section">
        <legend>{t('firmProfile.sections.about')}</legend>
        {textInput('name', t('firmProfile.name'), { required: true })}
        {textInput('tagline', t('firmProfile.tagline'), { hint: t('firmProfile.taglineHint') })}
        <div className="field">
          <label htmlFor="firm-description">{t('firmProfile.description')}</label>
          <span className="field-hint">{t('firmProfile.descriptionHint')}</span>
          <textarea
            id="firm-description"
            rows={5}
            required
            maxLength={4000}
            value={form.description}
            onChange={(event) => set('description', event.target.value)}
          />
          {firstError(errors, 'description') && (
            <span className="form-error">{firstError(errors, 'description')}</span>
          )}
        </div>
        <fieldset className="field">
          <legend>{t('firmProfile.areas')}</legend>
          <div className="check-grid">
            {PRACTICE_AREAS.map((area) => (
              <label key={area} className="choice">
                <input
                  type="checkbox"
                  checked={form.practice_areas.includes(area)}
                  onChange={() => set('practice_areas', toggle<PracticeArea>(form.practice_areas, area))}
                />
                <span className="choice__label">{t(`lawyers.areas.${area}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="field">
          <legend>{t('firmProfile.languages')}</legend>
          <div className="check-grid">
            {LANGUAGES.map((code) => (
              <label key={code} className="choice">
                <input
                  type="checkbox"
                  checked={form.languages.includes(code)}
                  onChange={() => set('languages', toggle<LanguageCode>(form.languages, code))}
                />
                <span className="choice__label">{t(`lawyers.languages.${code}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field-row">
          {textInput('city', t('firmProfile.city'))}
          <div className="field">
            <label htmlFor="firm-provinces">{t('firmProfile.provinces')}</label>
            <span className="field-hint">{t('firmProfile.provincesHint')}</span>
            <input
              id="firm-provinces"
              value={form.provinces.join(', ')}
              onChange={(event) =>
                set(
                  'provinces',
                  event.target.value
                    .split(',')
                    .map((code) => code.trim().toUpperCase())
                    .filter(Boolean),
                )
              }
            />
            {firstError(errors, 'provinces') && (
              <span className="form-error">{firstError(errors, 'provinces')}</span>
            )}
          </div>
          <div className="field">
            <label htmlFor="firm-years">{t('firmProfile.years')}</label>
            <input
              id="firm-years"
              type="number"
              min="0"
              value={form.years_in_practice ?? ''}
              onChange={(event) =>
                set('years_in_practice', event.target.value === '' ? null : Number(event.target.value))
              }
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>{t('firmProfile.sections.fees')}</legend>
        <p className="field-hint">{t('firmProfile.feesHint')}</p>
        <label className="choice">
          <input
            type="checkbox"
            checked={form.free_consultation}
            onChange={(event) => set('free_consultation', event.target.checked)}
          />
          <span className="choice__label">{t('firmProfile.freeConsultation')}</span>
        </label>
        <div className="field-row">
          {!form.free_consultation && moneyInput('consultation_fee', t('firmProfile.consultationFee'))}
          {moneyInput('hourly_rate_min', t('firmProfile.hourlyMin'))}
          {moneyInput('hourly_rate_max', t('firmProfile.hourlyMax'))}
        </div>
        <div className="field-row">
          {moneyInput('flat_fee_from', t('firmProfile.flatFrom'))}
          <div className="field">
            <label htmlFor="firm-contingency">{t('firmProfile.contingency')}</label>
            <input
              id="firm-contingency"
              type="number"
              min="0"
              max="50"
              value={form.contingency_percent ?? ''}
              onChange={(event) =>
                set('contingency_percent', event.target.value === '' ? null : Number(event.target.value))
              }
            />
            {firstError(errors, 'contingency_percent') && (
              <span className="form-error">{firstError(errors, 'contingency_percent')}</span>
            )}
          </div>
        </div>
        <label className="choice">
          <input
            type="checkbox"
            checked={form.sliding_scale}
            onChange={(event) => set('sliding_scale', event.target.checked)}
          />
          <span className="choice__label">{t('firmProfile.slidingScale')}</span>
        </label>
        <label className="choice">
          <input
            type="checkbox"
            checked={form.legal_aid}
            onChange={(event) => set('legal_aid', event.target.checked)}
          />
          <span className="choice__label">{t('firmProfile.legalAid')}</span>
        </label>
        <div className="field">
          <label htmlFor="firm-fee-notes">{t('firmProfile.feeNotes')}</label>
          <textarea
            id="firm-fee-notes"
            rows={2}
            maxLength={1000}
            value={form.fee_notes}
            onChange={(event) => set('fee_notes', event.target.value)}
          />
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>{t('firmProfile.sections.contact')}</legend>
        <div className="field-row">
          {textInput('website', t('firmProfile.website'), { type: 'url' })}
          {textInput('email', t('firmProfile.email'), { type: 'email' })}
          {textInput('phone', t('firmProfile.phone'), { type: 'tel' })}
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>{t('firmProfile.sections.verification')}</legend>
        {textInput('law_society_number', t('firmProfile.lawSociety'), {
          required: true,
          hint: t('firmProfile.lawSocietyHint'),
        })}
        <label className="choice">
          <input
            type="checkbox"
            checked={form.accepting_clients}
            onChange={(event) => set('accepting_clients', event.target.checked)}
          />
          <span>
            <span className="choice__label">{t('firmProfile.accepting')}</span>
            <span className="field-hint">{t('firmProfile.acceptingHint')}</span>
          </span>
        </label>
      </fieldset>

      {save.isError && !hasFieldErrors && (
        <p className="form-error" role="alert">
          {t('common.serverError')}
        </p>
      )}
      {save.isError && hasFieldErrors && (
        <p className="form-error" role="alert">
          {t('firmProfile.fixErrors')}
        </p>
      )}
      {save.isSuccess && (
        <p className="form-success" role="status">
          {t('firmProfile.saved')}
        </p>
      )}
      <div>
        <button className="button" type="submit" disabled={save.isPending}>
          {save.isPending ? t('firmProfile.saving') : t('firmProfile.save')}
        </button>
      </div>
    </form>
  )
}

export function ProfileStatus({ profile }: { profile: OwnLawFirm | null }) {
  const { t } = useTranslation()
  const state = !profile
    ? 'missing'
    : profile.is_listed
      ? 'listed'
      : !profile.is_verified
        ? 'pending'
        : 'hidden'
  return (
    <div className={`status-banner status-banner--${state}`} role="status">
      <strong>{t(`firmProfile.status.${state}Title`)}</strong>
      <span>{t(`firmProfile.status.${state}Text`)}</span>
    </div>
  )
}

function FirmProfilePage() {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useQuery({ queryKey: ['lawfirms', 'me'], queryFn: getMyProfile })
  const title = t('firmProfile.title')

  return (
    <>
      <title>{`${title} · ${t('app.name')}`}</title>
      <Link className="back-link" to="/firm">
        <Icon name="chevronLeft" />
        {t('case.backPartner')}
      </Link>
      <h1>{title}</h1>
      <p className="page-description">{t('firmProfile.description_page')}</p>
      {isLoading && <p role="status">{t('common.loading')}</p>}
      {isError && (
        <p className="form-error" role="alert">
          {t('common.serverError')}
        </p>
      )}
      {!isLoading && !isError && (
        <>
          <ProfileStatus profile={data ?? null} />
          <ProfileForm initial={data ?? null} />
        </>
      )}
    </>
  )
}

export default FirmProfilePage
