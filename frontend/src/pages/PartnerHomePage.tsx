import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { listCases } from '../api/cases.ts'
import { getMyProfile, listFirmRequests } from '../api/lawfirms.ts'
import FirmRequests from '../components/lawfirms/FirmRequests.tsx'
import { ProfileStatus } from './FirmProfilePage.tsx'

type PartnerHomeProps = {
  kind: 'hr' | 'firm'
}

/** Shared cases are real: the API lists only cases a worker has shared with this account. */
function SharedCases() {
  const { t, i18n } = useTranslation()
  const { data: cases, isLoading, isError } = useQuery({ queryKey: ['cases'], queryFn: listCases })
  const dateFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium' })

  return (
    <section className="partner-section" aria-labelledby="shared-title">
      <h2 id="shared-title" className="section-title">
        {t('partnerHome.sharedTitle')}
      </h2>
      {isLoading && <p role="status">{t('common.loading')}</p>}
      {isError && (
        <p className="form-error" role="alert">
          {t('common.serverError')}
        </p>
      )}
      {cases?.length === 0 && <p className="placeholder-notice">{t('partnerHome.sharedEmpty')}</p>}
      {cases && cases.length > 0 && (
        <ul className="case-list">
          {cases.map((item) => (
            <li key={item.id}>
              <Link className="case-card" to={`/cases/${item.id}`}>
                <span className="case-card__text">
                  <span className="case-card__title">{item.title}</span>
                  <span className="case-card__meta">
                    {t('partnerHome.sharedMeta', {
                      date: dateFormat.format(new Date(item.updated_at)),
                    })}
                  </span>
                </span>
                <span className="tag">{t('partnerHome.readOnly')}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function FirmStats() {
  const { t } = useTranslation()
  const requests = useQuery({ queryKey: ['lawfirms', 'me', 'requests'], queryFn: listFirmRequests })
  const cases = useQuery({ queryKey: ['cases'], queryFn: listCases })
  if (!requests.data || !cases.data) return null
  const pending = requests.data.filter((item) => item.status === 'pending').length
  const accepted = requests.data.filter((item) => item.status === 'accepted').length
  return (
    <dl className="stat-tiles firm-stats">
      <div className={`stat-tile${pending > 0 ? ' stat-tile--attention' : ''}`}>
        <dt>{t('partnerHome.firm.pending')}</dt>
        <dd>{pending}</dd>
      </div>
      <div className="stat-tile">
        <dt>{t('partnerHome.firm.shared')}</dt>
        <dd>{cases.data.length}</dd>
      </div>
      <div className="stat-tile">
        <dt>{t('partnerHome.firm.accepted')}</dt>
        <dd>{accepted}</dd>
      </div>
    </dl>
  )
}

function FirmOverview() {
  const { t } = useTranslation()
  const { data: profile, isLoading } = useQuery({ queryKey: ['lawfirms', 'me'], queryFn: getMyProfile })
  if (isLoading) {
    return <p role="status">{t('common.loading')}</p>
  }
  return (
    <>
      <div className="profile-summary">
        <ProfileStatus profile={profile ?? null} />
        <Link className="button button--secondary" to="/firm/profile">
          {profile ? t('firmProfile.edit') : t('firmProfile.create')}
        </Link>
      </div>
      <FirmStats />
      <FirmRequests canAccept={Boolean(profile?.is_verified)} />
    </>
  )
}

function PartnerHomePage({ kind }: PartnerHomeProps) {
  const { t } = useTranslation()
  const title = t(`partnerHome.${kind}.title`)

  return (
    <>
      <title>{`${title} · ${t('app.name')}`}</title>
      <p className="eyebrow">{t(`partnerHome.${kind}.eyebrow`)}</p>
      <h1>{title}</h1>
      <p className="page-description">{t(`partnerHome.${kind}.description`)}</p>

      {kind === 'firm' && <FirmOverview />}
      <SharedCases />
    </>
  )
}

export default PartnerHomePage
