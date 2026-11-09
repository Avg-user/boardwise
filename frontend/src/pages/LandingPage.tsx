import { useEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Owl, OwlMark } from '../components/brand/Owl.tsx'
import Icon, { type IconName } from '../components/Icon.tsx'
import { ScalesIcon } from '../components/partners/PartnerIcons.tsx'

const STEPS = [
  { key: 'talk', icon: 'chat' },
  { key: 'timeline', icon: 'timeline' },
  { key: 'next', icon: 'list' },
] as const satisfies readonly { key: string; icon: IconName }[]

const PROMISES = ['yours', 'username', 'voice', 'exit'] as const

const FIRM_POINTS = ['firmPoint1', 'firmPoint2', 'firmPoint3'] as const

/** True once most of the element has been on screen; it stays true after that. */
function useSeenOnce(ref: RefObject<HTMLElement | null>) {
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element || seen) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setSeen(true)
      },
      { threshold: 0.6 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, seen])
  return seen
}

/** The branch the hero owl stands on. Decorative. */
function Branch() {
  return (
    <svg className="landing-branch" viewBox="0 0 320 44" aria-hidden="true" focusable="false">
      <path className="landing-branch__leaf" d="M262 16 Q280 -4 302 6 Q286 24 262 16 Z" />
      <path className="landing-branch__leaf" d="M44 22 Q30 2 8 8 Q20 28 44 22 Z" />
      <path className="landing-branch__wood" d="M4 30 Q90 18 170 22 Q250 26 316 14" strokeWidth="11" />
      <path className="landing-branch__wood" d="M222 24 Q246 32 262 16" strokeWidth="6" />
      <path className="landing-branch__wood" d="M80 22 Q62 26 44 22" strokeWidth="6" />
    </svg>
  )
}

/** The public front page. Signed-in people never see it: HomeRoute sends them to their own home. */
function LandingPage() {
  const { t } = useTranslation()
  const privacyRef = useRef<HTMLElement>(null)
  // The owl covers its eyes when the privacy promises come into view.
  const privacyInView = useSeenOnce(privacyRef)

  return (
    <div className="landing">
      <title>{`${t('app.name')} · ${t('landing.titleSuffix')}`}</title>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero__text">
          <p className="eyebrow">{t('auth.eyebrow')}</p>
          <h1 id="landing-title" className="landing-hero__title">
            {t('landing.titleStart')} <em>{t('landing.titleEmphasis')}</em>
          </h1>
          <p className="landing-hero__lede">{t('landing.lede')}</p>
          <div className="landing-hero__actions">
            <Link className="button landing-button" to="/signup">
              {t('landing.getStarted')}
              <Icon name="chevronRight" />
            </Link>
            <Link className="button button--secondary landing-button" to="/login">
              {t('auth.signIn')}
            </Link>
          </div>
          <p className="landing-hero__note">{t('landing.heroNote')}</p>
        </div>
        <div className="landing-stage">
          <p className="landing-bubble">
            <strong>{t('landing.owlHello')}</strong> {t('landing.owlHelloText')}
          </p>
          <div className="landing-stage__owl">
            <Owl className="owl--hero" wave followPointer />
            <Branch />
          </div>
        </div>
      </section>

      <section className="landing-section" aria-labelledby="landing-steps-title">
        <div className="landing-speaker">
          <OwlMark className="landing-speaker__mark" />
          <div>
            <p className="eyebrow">{t('landing.stepsEyebrow')}</p>
            <h2 id="landing-steps-title" className="landing-section__title">
              {t('landing.stepsTitle')}
            </h2>
          </div>
        </div>
        <ol className="landing-steps">
          {STEPS.map(({ key, icon }, index) => (
            <li key={key} className="landing-step">
              <div className="landing-step__head">
                <span className="landing-step__number" aria-hidden="true">
                  {index + 1}
                </span>
                <Icon name={icon} className="landing-step__icon" />
              </div>
              <h3>{t(`landing.steps.${key}.title`)}</h3>
              <p>{t(`landing.steps.${key}.body`)}</p>
            </li>
          ))}
        </ol>
        <p className="landing-ai-note">{t('landing.aiNote')}</p>
      </section>

      <section
        ref={privacyRef}
        className="landing-section landing-privacy"
        aria-labelledby="landing-privacy-title"
      >
        <div className="landing-privacy__intro">
          <Owl className="owl--shy" coverEyes={privacyInView} />
          <p className="eyebrow">{t('landing.privacyEyebrow')}</p>
          <h2 id="landing-privacy-title" className="landing-section__title">
            {t('landing.privacyTitle')}
          </h2>
          <p className="landing-section__description">{t('landing.privacyDescription')}</p>
        </div>
        <ul className="landing-promises">
          {PROMISES.map((key) => (
            <li key={key}>
              <Icon name="check" className="landing-promises__check" />
              <span>
                <strong>{t(`landing.promises.${key}.title`)}</strong> {t(`landing.promises.${key}.body`)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="landing-section landing-partners" aria-labelledby="landing-partners-title">
        <div>
          <p className="eyebrow">{t('landing.partnersEyebrow')}</p>
          <h2 id="landing-partners-title" className="landing-section__title">
            {t('landing.partnersTitle')}
          </h2>
          <p className="landing-section__description">{t('partners.control')}</p>
        </div>
        <div className="landing-partners__side">
          <article className="landing-partner">
            <ScalesIcon />
            <div>
              <h3>{t('landing.firmCardTitle')}</h3>
              <ul>
                {FIRM_POINTS.map((point) => (
                  <li key={point}>{t(`partners.${point}`)}</li>
                ))}
              </ul>
            </div>
          </article>
          <div className="landing-partners__actions">
            <Link className="button button--secondary" to="/partners/login">
              {t('landing.firmSignIn')}
            </Link>
            <Link className="button-quiet" to="/partners/signup">
              {t('landing.firmSignUp')}
            </Link>
          </div>
        </div>
      </section>

      <section className="landing-cta" aria-labelledby="landing-cta-title">
        <Owl className="owl--cta" followPointer />
        <h2 id="landing-cta-title">{t('landing.ctaTitle')}</h2>
        <p>{t('landing.ctaBody')}</p>
        <Link className="button landing-button" to="/signup">
          {t('landing.getStarted')}
          <Icon name="chevronRight" />
        </Link>
      </section>

      <p className="landing-help">
        <Icon name="phone" />
        {t('landing.help')}
      </p>
    </div>
  )
}

export default LandingPage
