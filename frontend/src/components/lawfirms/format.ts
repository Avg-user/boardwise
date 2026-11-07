import type { TFunction } from 'i18next'
import type { LawFirm } from '../../api/lawfirms.ts'

export function money(value: string | null, language: string | undefined): string | null {
  if (value === null || value === '') return null
  return new Intl.NumberFormat(language, {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(Number(value))
}

/** Short fee lines for a firm, most useful first. */
export function feeLines(firm: LawFirm, t: TFunction, language: string | undefined): string[] {
  const lines: string[] = []
  if (firm.free_consultation) {
    lines.push(t('lawyers.fees.freeConsultation'))
  } else if (firm.consultation_fee) {
    lines.push(t('lawyers.fees.consultation', { amount: money(firm.consultation_fee, language) }))
  }
  const lo = money(firm.hourly_rate_min, language)
  const hi = money(firm.hourly_rate_max, language)
  if (lo && hi) lines.push(t('lawyers.fees.hourlyRange', { min: lo, max: hi }))
  else if (lo || hi) lines.push(t('lawyers.fees.hourly', { amount: lo ?? hi }))
  if (firm.flat_fee_from) {
    lines.push(t('lawyers.fees.flatFrom', { amount: money(firm.flat_fee_from, language) }))
  }
  if (firm.contingency_percent !== null) {
    lines.push(t('lawyers.fees.contingency', { percent: firm.contingency_percent }))
  }
  if (firm.sliding_scale) lines.push(t('lawyers.fees.slidingScale'))
  if (firm.legal_aid) lines.push(t('lawyers.fees.legalAid'))
  return lines
}
