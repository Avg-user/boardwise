import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { createCase, MAX_CASE_TITLE_LENGTH } from '../api/cases.ts'
import { ApiError } from '../api/client.ts'
import Dialog from './Dialog.tsx'

type NewCaseDialogProps = {
  open: boolean
  onClose: () => void
}

function NewCaseForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: createCase,
    onSuccess: async (created) => {
      queryClient.setQueryData(['cases', created.id], created)
      await queryClient.invalidateQueries({ queryKey: ['cases'], exact: true })
      onClose()
      navigate(`/cases/${created.id}`)
    },
    onError: (caught) => {
      const data = caught instanceof ApiError ? (caught.data as Record<string, unknown>) : null
      const message = Array.isArray(data?.title) ? data.title[0] : null
      setError(typeof message === 'string' ? message : t('common.serverError'))
    },
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) {
      setError(t('newCase.required'))
      return
    }
    setError(null)
    create.mutate(trimmed)
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor="new-case-title">{t('newCase.label')}</label>
        <input
          id="new-case-title"
          maxLength={MAX_CASE_TITLE_LENGTH}
          autoComplete="off"
          data-autofocus
          aria-describedby="new-case-title-hint"
          aria-invalid={Boolean(error)}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <span id="new-case-title-hint" className="field-hint">
          {t('newCase.hint')}
        </span>
        {error && (
          <span className="form-error" role="alert">
            {error}
          </span>
        )}
      </div>
      <div className="form-actions dialog__actions">
        <button type="button" className="button-quiet" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button className="button" type="submit" disabled={create.isPending}>
          {create.isPending ? t('newCase.creating') : t('newCase.create')}
        </button>
      </div>
    </form>
  )
}

/** A small pop-up for naming a new issue. */
function NewCaseDialog({ open, onClose }: NewCaseDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('newCase.title')}
      description={t('newCase.description')}
    >
      <NewCaseForm onClose={onClose} />
    </Dialog>
  )
}

export default NewCaseDialog
