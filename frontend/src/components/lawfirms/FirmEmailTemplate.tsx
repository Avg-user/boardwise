import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LawFirm } from '../../api/lawfirms.ts'
import Icon from '../Icon.tsx'

/**
 * A first email a worker can send a firm themselves: availability, consultation, fees, a
 * conflict check and how to reach them. Prefilled with the firm's name, editable, and never
 * saved: the text only leaves this page if the person copies it or opens their email app.
 */
function FirmEmailTemplate({ firm }: { firm: LawFirm }) {
  const { t } = useTranslation()
  const ids = { subject: useId(), body: useId() }
  const [subject, setSubject] = useState(() => t('firmEmail.subject'))
  const [body, setBody] = useState(() =>
    t('firmEmail.body', {
      firm: firm.name,
      consultation: firm.free_consultation ? t('firmEmail.consultationFree') : t('firmEmail.consultationAsk'),
    }),
  )
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null)
  const mailto = firm.email
    ? `mailto:${firm.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : null

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${t('firmEmail.subjectLabel')}: ${subject}\n\n${body}`)
      setCopied('ok')
    } catch {
      setCopied('failed')
    }
  }

  return (
    <section className="firm-section" aria-labelledby="firm-email-title">
      <h2 id="firm-email-title" className="section-title">
        {t('firmEmail.title')}
      </h2>
      <p className="firm-notes">{t('firmEmail.intro')}</p>
      <ul className="email-tips">
        <li>{t('firmEmail.tipBrackets')}</li>
        <li>{t('firmEmail.tipPrivate')}</li>
        <li>{t('firmEmail.tipConflict')}</li>
      </ul>
      <div className="email-template">
        <div className="field">
          <label htmlFor={ids.subject}>{t('firmEmail.subjectLabel')}</label>
          <input id={ids.subject} value={subject} onChange={(event) => setSubject(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={ids.body}>{t('firmEmail.bodyLabel')}</label>
          <textarea
            id={ids.body}
            rows={20}
            spellCheck
            value={body}
            onChange={(event) => {
              setBody(event.target.value)
              setCopied(null)
            }}
          />
        </div>
        <div className="form-actions">
          {mailto && (
            <a className="button" href={mailto}>
              {t('firmEmail.open')}
            </a>
          )}
          <button type="button" className={mailto ? 'button button--secondary' : 'button'} onClick={copy}>
            {copied === 'ok' && <Icon name="check" />}
            {copied === 'ok' ? t('firmEmail.copied') : t('firmEmail.copy')}
          </button>
        </div>
        <p className="field-hint" role="status">
          {copied === 'failed'
            ? t('firmEmail.copyFailed')
            : mailto
              ? t('firmEmail.sendTo', { email: firm.email })
              : t('firmEmail.noEmail')}
        </p>
      </div>
    </section>
  )
}

export default FirmEmailTemplate
