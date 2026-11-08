import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { LANGUAGES, listFirms, PRACTICE_AREAS, type FirmFilters } from '../api/lawfirms.ts'
import { feeLines } from '../components/lawfirms/format.ts'

/** How long typing has to pause before the search runs. */
const SEARCH_DELAY_MS = 300

function LawyersPage() {
  const { t, i18n } = useTranslation()
  // Filters live in the address, so going back from a firm, reloading or sharing keeps them.
  const [params, setParams] = useSearchParams()
  const filters: FirmFilters = {
    q: params.get('q') ?? '',
    area: params.get('area') ?? '',
    language: params.get('language') ?? '',
    freeConsultation: params.get('free') === '1',
  }

  function updateFilters(changes: Record<string, string | null>) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value)
          else next.delete(key)
        }
        return next
      },
      // Each change replaces the entry, so Back leaves the directory instead of undoing filters.
      { replace: true },
    )
  }

  // The box updates as you type; the search waits for a short pause.
  const [query, setQuery] = useState(filters.q ?? '')
  const [syncedQuery, setSyncedQuery] = useState(filters.q)
  if (filters.q !== syncedQuery) {
    // The address changed some other way (Back, a link to /lawyers): show what it says.
    setSyncedQuery(filters.q)
    if (query.trim() !== filters.q) setQuery(filters.q ?? '')
  }
  const searchTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(searchTimer.current), [])

  function handleQueryChange(value: string) {
    setQuery(value)
    window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(
      () => updateFilters({ q: value.trim() || null }),
      SEARCH_DELAY_MS,
    )
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    // Enter searches straight away.
    window.clearTimeout(searchTimer.current)
    updateFilters({ q: query.trim() || null })
  }

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

      <form className="filters" role="search" onSubmit={handleSubmit}>
        <div className="field filters__search">
          <label htmlFor="firm-search">{t('lawyers.filters.search')}</label>
          <input
            id="firm-search"
            type="search"
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="firm-area">{t('lawyers.filters.area')}</label>
          <select
            id="firm-area"
            value={filters.area ?? ''}
            onChange={(event) => updateFilters({ area: event.target.value || null })}
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
            onChange={(event) => updateFilters({ language: event.target.value || null })}
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
            onChange={(event) => updateFilters({ free: event.target.checked ? '1' : null })}
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
              <Link
                className="firm-card"
                to={`/lawyers/${firm.id}`}
                state={{ directorySearch: params.toString() ? `?${params}` : '' }}
              >
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
