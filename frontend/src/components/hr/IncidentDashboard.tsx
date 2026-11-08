import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { getDashboard, type Dashboard } from '../../api/hr.ts'

/** "2026-06-01" → a local date, so the month never shifts with the time zone. */
function monthDate(iso: string): Date {
  const [year, month] = iso.split('-').map(Number)
  return new Date(year, month - 1, 1)
}

/** A clean axis top: 5, 10, 20, 25, 50, 100… at or above the largest value. */
function niceMax(value: number): number {
  const steps = [5, 10, 20, 25, 50]
  let scale = 1
  for (;;) {
    for (const step of steps) {
      if (step * scale >= value) return step * scale
    }
    scale *= 10
  }
}

function useFormatters() {
  const { i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  return {
    short: new Intl.DateTimeFormat(lang, { month: 'short' }),
    long: new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }),
    number: new Intl.NumberFormat(lang),
  }
}

function MonthChart({ data }: { data: Dashboard }) {
  const { t } = useTranslation()
  const fmt = useFormatters()
  const k = data.min_group_size
  const top = niceMax(Math.max(...data.months.map((m) => m.count ?? 0), k))
  const ticks = [0, top / 2, top]

  return (
    <figure className="chart">
      <figcaption>
        <h3 className="chart__title">{t('hrDashboard.byMonth')}</h3>
        <p className="chart__subtitle">{t('hrDashboard.byMonthHint')}</p>
      </figcaption>
      <div className="column-chart">
        <div className="column-chart__axis" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} style={{ bottom: `${(tick / top) * 100}%` }}>
              {fmt.number.format(tick)}
            </span>
          ))}
        </div>
        <div className="column-chart__grid" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} style={{ bottom: `${(tick / top) * 100}%` }} />
          ))}
        </div>
        <ol className="column-chart__plot">
          {data.months.map(({ month, count }) => {
            const date = monthDate(month)
            const value =
              count === null ? t('hrDashboard.hiddenCount', { k }) : t('hrDashboard.reports', { count })
            return (
              <li
                key={month}
                className="column-chart__slot"
                tabIndex={0}
                aria-label={`${fmt.long.format(date)}: ${value}`}
              >
                <span className="column-chart__track">
                  {count === null ? (
                    <span className="column-chart__hidden" aria-hidden="true">
                      {`<${k}`}
                    </span>
                  ) : (
                    count > 0 && (
                      <span className="column-chart__bar" style={{ height: `${(count / top) * 100}%` }} />
                    )
                  )}
                </span>
                <span className="column-chart__label" aria-hidden="true">
                  {fmt.short.format(date)}
                </span>
                <span className="chart-tooltip" aria-hidden="true">
                  <strong>{fmt.long.format(date)}</strong>
                  <span>{value}</span>
                </span>
              </li>
            )
          })}
        </ol>
      </div>
    </figure>
  )
}

function CategoryBars({ data }: { data: Dashboard }) {
  const { t } = useTranslation()
  const fmt = useFormatters()
  const k = data.min_group_size
  const top = Math.max(...data.categories.map((c) => c.count ?? 0), k)

  return (
    <figure className="chart">
      <figcaption>
        <h3 className="chart__title">{t('hrDashboard.byCategory')}</h3>
        <p className="chart__subtitle">{t('hrDashboard.byCategoryHint')}</p>
      </figcaption>
      <ul className="bar-list">
        {data.categories.map(({ category, count }) => (
          <li key={category} className="bar-list__row">
            <span className="bar-list__label">{t(`incidentCategories.${category}`)}</span>
            <span className="bar-list__track">
              {count !== null && (
                <span className="bar-list__bar" style={{ width: `${(count / top) * 100}%` }} />
              )}
              <span className="bar-list__value">
                {count === null ? t('hrDashboard.hiddenCount', { k }) : fmt.number.format(count)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

function DataTable({ data }: { data: Dashboard }) {
  const { t } = useTranslation()
  const fmt = useFormatters()
  const hidden = t('hrDashboard.hiddenCount', { k: data.min_group_size })
  return (
    <details className="chart-table">
      <summary>{t('hrDashboard.showTable')}</summary>
      <table>
        <caption className="visually-hidden">{t('hrDashboard.byMonth')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('hrDashboard.month')}</th>
            <th scope="col">{t('hrDashboard.count')}</th>
          </tr>
        </thead>
        <tbody>
          {data.months.map(({ month, count }) => (
            <tr key={month}>
              <th scope="row">{fmt.long.format(monthDate(month))}</th>
              <td>{count === null ? hidden : fmt.number.format(count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table>
        <caption className="visually-hidden">{t('hrDashboard.byCategory')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('hrDashboard.category')}</th>
            <th scope="col">{t('hrDashboard.count')}</th>
          </tr>
        </thead>
        <tbody>
          {data.categories.map(({ category, count }) => (
            <tr key={category}>
              <th scope="row">{t(`incidentCategories.${category}`)}</th>
              <td>{count === null ? hidden : fmt.number.format(count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

function IncidentDashboard() {
  const { t } = useTranslation()
  const fmt = useFormatters()
  const { data, isLoading, isError } = useQuery({ queryKey: ['hr', 'dashboard'], queryFn: getDashboard })

  if (isLoading) return <p role="status">{t('common.loading')}</p>
  if (isError || !data) {
    return (
      <p className="form-error" role="alert">
        {t('common.serverError')}
      </p>
    )
  }

  const k = data.min_group_size
  const period = t('hrDashboard.period', {
    start: fmt.long.format(monthDate(data.window_start)),
    end: fmt.long.format(monthDate(data.window_end)),
  })

  if (!data.enough_data) {
    return (
      <div className="empty-state">
        <p>{t('hrDashboard.notEnough', { k })}</p>
        <p className="field-hint">{period}</p>
      </div>
    )
  }

  const topCategory = data.categories.find((c) => c.count !== null)
  const ongoing = data.ongoing?.ongoing ?? null

  return (
    <div className="hr-dashboard">
      <p className="field-hint">{period}</p>
      <dl className="stat-tiles">
        <div className="stat-tile stat-tile--hero">
          <dt>{t('hrDashboard.total')}</dt>
          <dd>{fmt.number.format(data.total ?? 0)}</dd>
        </div>
        <div className="stat-tile">
          <dt>{t('hrDashboard.ongoing')}</dt>
          <dd>{ongoing === null ? t('hrDashboard.hiddenCount', { k }) : fmt.number.format(ongoing)}</dd>
        </div>
        <div className="stat-tile">
          <dt>{t('hrDashboard.topCategory')}</dt>
          <dd>{topCategory ? t(`incidentCategories.${topCategory.category}`) : '—'}</dd>
        </div>
      </dl>
      <div className="chart-grid">
        <MonthChart data={data} />
        <CategoryBars data={data} />
      </div>
      <DataTable data={data} />
      <p className="field-hint">{t('hrDashboard.privacyNote', { k })}</p>
    </div>
  )
}

export default IncidentDashboard
