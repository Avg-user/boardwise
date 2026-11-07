import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { MAX_CASE_TITLE_LENGTH, updateCase } from '../../api/cases.ts'
import type { Case, CaseStatus } from '../../api/types.ts'

type Changes = { title?: string; status?: CaseStatus }

function CaseHeader({ caseItem }: { caseItem: Case }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [isRenaming, setIsRenaming] = useState(false)
  const [draft, setDraft] = useState(caseItem.title)
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const renameButtonRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)

  const update = useMutation({
    mutationFn: (changes: Changes) => updateCase(caseItem.id, changes),
    onSuccess: (updated) => {
      queryClient.setQueryData(['cases', caseItem.id], updated)
      void queryClient.invalidateQueries({ queryKey: ['cases'], exact: true })
    },
  })

  // Put focus back on the Rename button after the form closes, so keyboard users don't lose their place.
  useEffect(() => {
    if (!isRenaming && returnFocus.current) {
      returnFocus.current = false
      renameButtonRef.current?.focus()
    }
  }, [isRenaming])

  function closeRename() {
    returnFocus.current = true
    setIsRenaming(false)
    setError(null)
  }

  function startRename() {
    setDraft(caseItem.title)
    setIsRenaming(true)
  }

  async function handleRename(event: FormEvent) {
    event.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed) {
      setError(t('newCase.required'))
      return
    }
    if (trimmed === caseItem.title) {
      closeRename()
      return
    }
    try {
      await update.mutateAsync({ title: trimmed })
      closeRename()
    } catch {
      setError(t('common.serverError'))
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      closeRename()
    }
  }

  async function toggleStatus() {
    const status: CaseStatus = caseItem.status === 'open' ? 'closed' : 'open'
    try {
      await update.mutateAsync({ status })
      setAnnouncement(status === 'closed' ? t('case.statusClosed') : t('case.statusReopened'))
    } catch {
      setAnnouncement(t('common.serverError'))
    }
  }

  if (isRenaming) {
    return (
      <form className="rename-form" onSubmit={handleRename} onKeyDown={handleKeyDown} noValidate>
        {/* Keeps the page's main heading for screen readers while the visible title is being edited. */}
        <h1 className="visually-hidden">{caseItem.title}</h1>
        <label className="visually-hidden" htmlFor="rename-case">
          {t('newCase.label')}
        </label>
        <input
          id="rename-case"
          className="rename-form__input"
          maxLength={MAX_CASE_TITLE_LENGTH}
          autoComplete="off"
          autoFocus
          aria-invalid={Boolean(error)}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        {error && (
          <span className="form-error" role="alert">
            {error}
          </span>
        )}
        <div className="form-actions">
          <button className="button" type="submit" disabled={update.isPending}>
            {update.isPending ? t('case.saving') : t('case.save')}
          </button>
          <button type="button" className="button-quiet" onClick={closeRename}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="case-header">
      <h1>
        {caseItem.title}
        {caseItem.status === 'closed' && (
          <>
            {' '}
            <span className="status-badge">{t('case.closedBadge')}</span>
          </>
        )}
      </h1>
      {caseItem.is_owner && (
        <div className="case-header__actions">
          <button ref={renameButtonRef} type="button" className="button-quiet" onClick={startRename}>
            {t('case.rename')}
          </button>
          <button
            type="button"
            className="button-quiet"
            disabled={update.isPending}
            onClick={toggleStatus}
          >
            {caseItem.status === 'open' ? t('case.closeIssue') : t('case.reopenIssue')}
          </button>
        </div>
      )}
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
    </div>
  )
}

export default CaseHeader
