import { ApiError, request } from './client.ts'

// Matches apps/hr on the backend.

export const INCIDENT_CATEGORIES = [
  'harassment',
  'sexual_harassment',
  'discrimination',
  'violence',
  'safety',
  'pay',
  'retaliation',
  'other',
] as const
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number]

export type Company = {
  id: number
  name: string
  province: string
  city: string
}

export type OwnCompany = Company & {
  is_verified: boolean
  verified_at: string | null
}

export type CompanyInput = Pick<Company, 'name' | 'province' | 'city'>

/** Counts are null when they're too small to show without risking someone's anonymity. */
export type Dashboard = {
  company: OwnCompany
  min_group_size: number
  window_start: string
  window_end: string
  enough_data: boolean
  total: number | null
  months: { month: string; count: number | null }[]
  categories: { category: IncidentCategory; count: number | null }[]
  ongoing: { ongoing: number | null; resolved: number | null } | null
}

export type Workplace = {
  company: number | null
  company_name: string | null
  reporting_opt_in: boolean
}

export type IncidentReportInput = {
  category: IncidentCategory
  /** "YYYY-MM", as an <input type="month"> gives it. */
  occurred_month: string
  ongoing: boolean
}

export type OfferStatus = 'pending' | 'processing' | 'done' | 'failed'
/** Why a check failed. no_text: e.g. a scanned PDF; retrying won't help, but pasting the text will. */
export type OfferFailure = '' | 'no_text' | 'unreadable' | 'model' | 'queue' | 'partial'
export type FindingSeverity = 'violation' | 'concern' | 'info'

export type Finding = {
  severity: FindingSeverity
  title: string
  offer_quote: string
  explanation: string
  citation: string
}

export type JobOffer = {
  id: number
  title: string
  /** Only in the detail response. */
  text?: string
  province: string
  status: OfferStatus
  failure: OfferFailure
  summary: string
  findings: Finding[]
  /** Long offers are checked in parts. `partial` (with status done) means some weren't answered. */
  parts_total: number
  parts_unchecked: number[]
  created_at: string
  reviewed_at: string | null
}

/** Resolves to null when this HR account hasn't set up a company yet. */
export async function getMyCompany(): Promise<OwnCompany | null> {
  try {
    return await request<OwnCompany>('/hr/company/')
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null
    }
    throw error
  }
}

export function saveMyCompany(input: CompanyInput): Promise<OwnCompany> {
  return request<OwnCompany>('/hr/company/', { method: 'PUT', json: input })
}

export function getDashboard(): Promise<Dashboard> {
  return request<Dashboard>('/hr/dashboard/')
}

export function listJobOffers(): Promise<JobOffer[]> {
  return request<JobOffer[]>('/hr/job-offers/')
}

export function getJobOffer(id: number): Promise<JobOffer> {
  return request<JobOffer>(`/hr/job-offers/${id}/`)
}

export function submitJobOffer(input: { file: File } | { text: string; title?: string }): Promise<JobOffer> {
  const form = new FormData()
  if ('file' in input) {
    form.append('file', input.file)
  } else {
    form.append('text', input.text)
    if (input.title?.trim()) form.append('title', input.title.trim())
  }
  return request<JobOffer>('/hr/job-offers/', { method: 'POST', form })
}

export function retryJobOffer(id: number): Promise<JobOffer> {
  return request<JobOffer>(`/hr/job-offers/${id}/retry/`, { method: 'POST' })
}

export function deleteJobOffer(id: number): Promise<void> {
  return request<void>(`/hr/job-offers/${id}/`, { method: 'DELETE' })
}

export function listCompanies(q = ''): Promise<Company[]> {
  return request<Company[]>(`/companies/${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)
}

export function getWorkplace(): Promise<Workplace> {
  return request<Workplace>('/workplace/')
}

export function saveWorkplace(input: Partial<Pick<Workplace, 'company' | 'reporting_opt_in'>>): Promise<Workplace> {
  return request<Workplace>('/workplace/', { method: 'PATCH', json: input })
}

export function leaveWorkplace(): Promise<void> {
  return request<void>('/workplace/', { method: 'DELETE' })
}

export function sendIncidentReport(input: IncidentReportInput): Promise<void> {
  return request<void>('/workplace/reports/', { method: 'POST', json: input })
}
