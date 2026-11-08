import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Dialog from './Dialog.tsx'

type ConfirmDialogProps = {
  open: boolean
  onClose: () => void
  title: string
  message: string
  confirmLabel: string
  pendingLabel: string
  /** Closes the dialog when it resolves; shows an error and stays open when it throws. */
  onConfirm: () => Promise<unknown>
}

function ConfirmActions({ onClose, confirmLabel, pendingLabel, onConfirm }: Omit<ConfirmDialogProps, 'open' | 'title' | 'message'>) {
  const { t } = useTranslation()
  const [isPending, setIsPending] = useState(false)
  const [failed, setFailed] = useState(false)

  async function confirm() {
    setIsPending(true)
    setFailed(false)
    try {
      await onConfirm()
      onClose()
    } catch {
      setFailed(true)
      setIsPending(false)
    }
  }

  return (
    <>
      {failed && (
        <p className="form-error" role="alert">
          {t('common.serverError')}
        </p>
      )}
      <div className="form-actions dialog__actions">
        {/* Cancel gets focus first, so pressing Enter by habit doesn't confirm. */}
        <button type="button" className="button-quiet" onClick={onClose} data-autofocus>
          {t('common.cancel')}
        </button>
        <button type="button" className="button" disabled={isPending} onClick={confirm}>
          {isPending ? pendingLabel : confirmLabel}
        </button>
      </div>
    </>
  )
}

/** Asks before an action that can't be undone, such as deleting an entry or closing a chat. */
function ConfirmDialog({ open, title, message, ...actions }: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={actions.onClose} title={title} description={message}>
      <ConfirmActions {...actions} />
    </Dialog>
  )
}

export default ConfirmDialog
