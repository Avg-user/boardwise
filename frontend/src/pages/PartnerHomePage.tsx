import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { listCases } from '../api/cases.ts'
import { getMyProfile } from '../api/lawfirms.ts'
import FirmRequests from '../components/lawfirms/FirmRequests.tsx'
import { ProfileStatus } from './FirmProfilePage.tsx'
import { BuildingIcon, ScalesIcon } from '../components/partners/PartnerIcons.tsx'

type PartnerHomeProps = {
  kind: 'hr' | 'firm'
}

// Exact keys per role, so the typed i18n keys stay checkable.
const UPCOMING = {
  hr: [
    { title: 'partnerHome.hr.reportsTitle', text: 'partnerHome.hr.reportsText' },
    { title: 'partnerHome.hr.trendsTitle', text: 'partnerHome.hr.trendsText' },
    { title: 'partnerHome.hr.jobsTitle', text: 'partnerHome.hr.jobsText' },
  ],
  firm: [{ title: 'partnerHome.firm.statsTitle', text: 'partnerHome.firm.statsText' }],
} as const

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
        <Link className="button" to="/firm/profile">
          {profile ? t('firmProfile.edit') : t('firmProfile.create')}
        </Link>
      </div>
      <FirmRequests canAccept={Boolean(profile?.is_verified)} />
    </>
  )
}

function PartnerHomePage({ kind }: PartnerHomeProps) {
  const { t } = useTranslation()
  const title = t(`partnerHome.${kind}.title`)
  const Icon = kind === 'hr' ? BuildingIcon : ScalesIcon

  return (
    <>
      <title>{`${title} · ${t('app.name')}`}</title>
      <p className="eyebrow">{t(`partnerHome.${kind}.eyebrow`)}</p>
      <h1>{title}</h1>
      <p className="page-description">{t(`partnerHome.${kind}.description`)}</p>

      {kind === 'firm' && <FirmOverview />}
      {kind === 'firm' && <SharedCases />}

      <section className="partner-section" aria-labelledby="upcoming-title">
        <h2 id="upcoming-title" className="section-title">
          {t('partnerHome.upcomingTitle')}
        </h2>
        <ul className="feature-tiles">
          {UPCOMING[kind].map((item) => (
            <li key={item.title} className="feature-tile">
              <Icon />
              <h3>{t(item.title)}</h3>
              <p>{t(item.text)}</p>
              <span className="tag tag--muted">{t('partnerHome.comingSoon')}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

export default PartnerHomePage
