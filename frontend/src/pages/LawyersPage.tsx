import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { LANGUAGES, listFirms, PRACTICE_AREAS, type FirmFilters } from '../api/lawfirms.ts'
import { feeLines } from '../components/lawfirms/format.ts'

function LawyersPage() {
  const { t, i18n } = useTranslation()
  const [filters, setFilters] = useState<FirmFilters>({})
  const { data: firms, isLoading, isError } = useQuery({
    queryKey: ['lawfirms', filters],
    queryFn: () => listFirms(filters),
    placeholderData: (previous) => previous,
  })
  const title = t('lawyers.title')

  return (
    <>
      <title>{`${title} · ${t('app.name')}`}</title>
      <p className="eyebrow">{t('lawyers.eyebrow')}</p>
      <h1>{title}</h1>
      <p className="page-description">{t('lawyers.description')}</p>

      <form className="filters" role="search" onSubmit={(event) => event.preventDefault()}>
        <div className="field">
          <label htmlFor="firm-search">{t('lawyers.filters.search')}</label>
          <input
            id="firm-search"
            type="search"
            value={filters.q ?? ''}
            onChange={(event) => setFilters({ ...filters, q: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="firm-area">{t('lawyers.filters.area')}</label>
          <select
            id="firm-area"
            value={filters.area ?? ''}
            onChange={(event) => setFilters({ ...filters, area: event.target.value })}
          >
            <option value="">{t('lawyers.filters.any')}</option>
            {PRACTICE_AREAS.map((area) => (
              <option key={area} value={area}>
                {t(`lawyers.areas.${area}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="firm-language">{t('lawyers.filters.language')}</label>
          <select
            id="firm-language"
            value={filters.language ?? ''}
            onChange={(event) => setFilters({ ...filters, language: event.target.value })}
          >
            <option value="">{t('lawyers.filters.any')}</option>
            {LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {t(`lawyers.languages.${code}`)}
              </option>
            ))}
          </select>
        </div>
        <label className="choice filters__check">
          <input
            type="checkbox"
            checked={filters.freeConsultation ?? false}
            onChange={(event) => setFilters({ ...filters, freeConsultation: event.target.checked })}
          />
          <span className="choice__label">{t('lawyers.filters.free')}</span>
        </label>
      </form>

      {isLoading && <p role="status">{t('common.loading')}</p>}
      {isError && (
        <p className="form-error" role="alert">
          {t('common.serverError')}
        </p>
      )}
      {firms?.length === 0 && <p className="placeholder-notice">{t('lawyers.empty')}</p>}
      {firms && firms.length > 0 && (
        <ul className="firm-grid" aria-live="polite">
          {firms.map((firm) => (
            <li key={firm.id}>
              <Link className="firm-card" to={`/lawyers/${firm.id}`}>
                <span className="firm-card__head">
                  <span className="firm-card__name">{firm.name}</span>
                  <span className="tag">{t('lawyers.verified')}</span>
                </span>
                {firm.tagline && <span className="firm-card__tagline">{firm.tagline}</span>}
                <span className="chips">
                  {firm.practice_areas.slice(0, 3).map((area) => (
                    <span key={area} className="chip">
                      {t(`lawyers.areas.${area}`)}
                    </span>
                  ))}
                </span>
                <span className="firm-card__meta">
                  {[firm.city, firm.languages.map((code) => t(`lawyers.languages.${code}`)).join(', ')]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className="firm-card__fee">{feeLines(firm, t, i18n.resolvedLanguage)[0]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

export default LawyersPage
