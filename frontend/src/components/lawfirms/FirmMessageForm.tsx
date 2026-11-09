import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import type { LawFirm } from '../../api/lawfirms.ts'
import { listThreads, startThread, THREADS_KEY } from '../../api/messages.ts'

/**
 * A worker's first message to a firm, sent through Boardwise. Prefilled with what firms usually
 * ask about at first contact: availability, the consultation, fees, language, the employer's
 * name for a conflict check, key dates. The firm replies in Messages; it never sees the
 * worker's username or issues.
 */
function FirmMessageForm({ firm }: { firm: LawFirm }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const ids = { subject: useId(), body: useId() }
  const threads = useQuery({ queryKey: THREADS_KEY, queryFn: listThreads })
  const existing = threads.data?.find((thread) => thread.firm === firm.id) ?? null
  const [subject, setSubject] = useState(() => t('firmEmail.subject'))
  const [body, setBody] = useState(() =>
    t('firmEmail.body', {
      firm: firm.name,
      consultation: firm.free_consultation ? t('firmEmail.consultationFree') : t('firmEmail.consultationAsk'),
    }),
  )
  const send = useMutation({
    mutationFn: () => startThread({ firm: firm.id, subject: subject.trim(), body: body.trim() }),
    onSuccess: (thread) => {
      queryClient.setQueryData([...THREADS_KEY, thread.id], thread)
      void queryClient.invalidateQueries({ queryKey: THREADS_KEY, exact: true })
      navigate(`/messages/${thread.id}`)
    },
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (subject.trim() && body.trim() && !send.isPending) send.mutate()
  }

  return (
    <section className="firm-section" aria-labelledby="firm-message-title">
      <h2 id="firm-message-title" className="section-title">
        {t('firmEmail.title')}
      </h2>
      {existing ? (
        <div className="email-template">
          <p className="firm-notes">{t('firmEmail.existing')}</p>
          <Link className="button" to={`/messages/${existing.id}`}>
            {t('firmEmail.openConversation')}
          </Link>
        </div>
      ) : (
        <>
          <p className="firm-notes">{t('firmEmail.intro')}</p>
          <ul className="email-tips">
            <li>{t('firmEmail.tipBrackets')}</li>
            <li>{t('firmEmail.tipPrivate')}</li>
            <li>{t('firmEmail.tipConflict')}</li>
          </ul>
          <form className="email-template" onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor={ids.subject}>{t('firmEmail.subjectLabel')}</label>
              <input
                id={ids.subject}
                required
                maxLength={200}
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor={ids.body}>{t('firmEmail.bodyLabel')}</label>
              <textarea
                id={ids.body}
                rows={20}
                required
                maxLength={5000}
                spellCheck
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
            </div>
            {send.isError && (
              <p className="form-error" role="alert">
                {t('messages.sendFailed')}
              </p>
            )}
            <div className="form-actions">
              <button className="button" type="submit" disabled={send.isPending || !subject.trim() || !body.trim()}>
                {send.isPending ? t('firmEmail.sending') : t('firmEmail.send')}
              </button>
            </div>
            <p className="field-hint">{t('firmEmail.privacy')}</p>
          </form>
        </>
      )}
    </section>
  )
}

export default FirmMessageForm
