import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { createTimelineEntry, MAX_CASE_TITLE_LENGTH, updateTimelineEntry } from '../../api/cases.ts'
import { ApiError } from '../../api/client.ts'
import type { TimelineEntry, TimelineEntryInput } from '../../api/types.ts'
import { todayLocal } from '../../utils/date.ts'
import Dialog from '../Dialog.tsx'

type TimelineEntryDialogProps = {
  caseId: number
  open: boolean
  onClose: () => void
  /** The entry to edit. Leave out to add a new one. */
  entry?: TimelineEntry | null
}

type FieldErrors = { occurred_at?: string; title?: string; form?: string }

function firstMessage(value: unknown): string | undefined {
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined
}

function EntryForm({ caseId, entry, onClose }: Omit<TimelineEntryDialogProps, 'open'>) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const today = todayLocal()
  const [date, setDate] = useState(entry?.occurred_at ?? today)
  const [title, setTitle] = useState(entry?.title ?? '')
  const [description, setDescription] = useState(entry?.description ?? '')
  const [errors, setErrors] = useState<FieldErrors>({})

  const save = useMutation({
    mutationFn: (input: TimelineEntryInput) =>
      entry ? updateTimelineEntry(caseId, entry.id, input) : createTimelineEntry(caseId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['cases', caseId, 'timeline'] })
      onClose()
    },
    onError: (caught) => {
      const data = caught instanceof ApiError ? ((caught.data ?? {}) as Record<string, unknown>) : {}
      const fields = { occurred_at: firstMessage(data.occurred_at), title: firstMessage(data.title) }
      setErrors({
        ...fields,
        form: fields.occurred_at || fields.title ? undefined : t('common.serverError'),
      })
    },
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const found: FieldErrors = {}
    if (!date) {
      found.occurred_at = t('entry.dateRequired')
    } else if (date > today) {
      found.occurred_at = t('entry.dateFuture')
    }
    if (!title.trim()) {
      found.title = t('entry.titleRequired')
    }
    setErrors(found)
    if (Object.keys(found).length > 0) {
      return
    }
    save.mutate({ occurred_at: date, title: title.trim(), description: description.trim() })
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor="entry-date">{t('entry.dateLabel')}</label>
        <input
          id="entry-date"
          type="date"
          max={today}
          required
          aria-invalid={Boolean(errors.occurred_at)}
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        {errors.occurred_at && (
          <span className="form-error" role="alert">
            {errors.occurred_at}
          </span>
        )}
      </div>
      <div className="field">
        <label htmlFor="entry-title">{t('entry.titleLabel')}</label>
        <input
          id="entry-title"
          maxLength={MAX_CASE_TITLE_LENGTH}
          autoComplete="off"
          data-autofocus
          required
          aria-describedby="entry-title-hint"
          aria-invalid={Boolean(errors.title)}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <span id="entry-title-hint" className="field-hint">
          {t('entry.titleHint')}
        </span>
        {errors.title && (
          <span className="form-error" role="alert">
            {errors.title}
          </span>
        )}
      </div>
      <div className="field">
        <label htmlFor="entry-description">{t('entry.descriptionLabel')}</label>
        <textarea
          id="entry-description"
          rows={3}
          aria-describedby="entry-description-hint"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <span id="entry-description-hint" className="field-hint">
          {t('entry.descriptionHint')}
        </span>
      </div>
      {errors.form && (
        <p className="form-error" role="alert">
          {errors.form}
        </p>
      )}
      <div className="form-actions dialog__actions">
        <button type="button" className="button-quiet" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button className="button" type="submit" disabled={save.isPending}>
          {save.isPending ? t('entry.saving') : t('entry.save')}
        </button>
      </div>
    </form>
  )
}

/** Add a timeline entry, or edit one. AI-drafted suggestions can prefill this form later. */
function TimelineEntryDialog({ caseId, open, onClose, entry }: TimelineEntryDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={entry ? t('entry.editTitle') : t('entry.addTitle')}
      description={t('entry.description')}
    >
      <EntryForm caseId={caseId} entry={entry} onClose={onClose} />
    </Dialog>
  )
}

export default TimelineEntryDialog
