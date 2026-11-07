import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { listTimeline } from '../../api/cases.ts'

function TimelinePanel({ caseId }: { caseId: number }) {
  const { t, i18n } = useTranslation()
  const { data: entries, isLoading, isError } = useQuery({
    queryKey: ['cases', caseId, 'timeline'],
    queryFn: () => listTimeline(caseId),
  })

  // Dates have no time of day, so format in UTC to keep them from shifting a day.
  const dateFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  })

  return (
    <>
      <h2>{t('case.timeline')}</h2>
      {isLoading && <p role="status">{t('common.loading')}</p>}
      {isError && (
        <p className="form-error" role="alert">
          {t('common.serverError')}
        </p>
      )}
      {entries?.length === 0 && <p className="placeholder-notice">{t('case.timelineEmpty')}</p>}
      {entries && entries.length > 0 && (
        <ol className="timeline">
          {entries.map((entry) => (
            <li key={entry.id}>
              <time dateTime={entry.occurred_at}>
                {dateFormat.format(new Date(entry.occurred_at))}
              </time>
              <span className="timeline__title">{entry.title}</span>
              {entry.description && <span className="field-hint">{entry.description}</span>}
            </li>
          ))}
        </ol>
      )}
    </>
  )
}

export default TimelinePanel
