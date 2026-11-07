import { ApiError, request } from './client.ts'

// Matches apps/lawfirms on the backend. Money comes back as decimal strings, e.g. "275.00".

export const PRACTICE_AREAS = [
  'harassment',
  'discrimination',
  'dismissal',
  'wages',
  'safety',
  'workers_comp',
  'contracts',
  'other',
] as const
export type PracticeArea = (typeof PRACTICE_AREAS)[number]

export const LANGUAGES = ['en', 'fr', 'es', 'pa', 'tl', 'zh', 'ar', 'hi', 'other'] as const
export type LanguageCode = (typeof LANGUAGES)[number]

export type LawFirm = {
  id: number
  name: string
  tagline: string
  description: string
  practice_areas: PracticeArea[]
  languages: LanguageCode[]
  provinces: string[]
  city: string
  years_in_practice: number | null
  free_consultation: boolean
  consultation_fee: string | null
  hourly_rate_min: string | null
  hourly_rate_max: string | null
  flat_fee_from: string | null
  contingency_percent: number | null
  sliding_scale: boolean
  legal_aid: boolean
  fee_notes: string
  website: string
  email: string
  phone: string
  is_verified: boolean
}

export type OwnLawFirm = LawFirm & {
  law_society_number: string
  verified_at: string | null
  accepting_clients: boolean
  is_listed: boolean
}

export type LawFirmInput = Omit<OwnLawFirm, 'id' | 'is_verified' | 'verified_at' | 'is_listed'>

export type MatchStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'ended'

/** A request as the worker sees it, on one of their cases. */
export type CaseMatch = {
  id: number
  firm: number
  firm_name: string
  message: string
  status: MatchStatus
  created_at: string
  responded_at: string | null
}

/** A request as the firm sees it. The case is hidden until the firm accepts. */
export type FirmRequest = {
  id: number
  message: string
  status: MatchStatus
  created_at: string
  responded_at: string | null
  case_id: number | null
  case_title: string | null
}

export type FirmFilters = {
  area?: string
  language?: string
  freeConsultation?: boolean
  q?: string
}

export function listFirms(filters: FirmFilters = {}): Promise<LawFirm[]> {
  const params = new URLSearchParams()
  if (filters.area) params.set('area', filters.area)
  if (filters.language) params.set('language', filters.language)
  if (filters.freeConsultation) params.set('free_consultation', '1')
  if (filters.q?.trim()) params.set('q', filters.q.trim())
  const query = params.toString()
  return request<LawFirm[]>(`/lawfirms/${query ? `?${query}` : ''}`)
}

export function getFirm(id: number): Promise<LawFirm> {
  return request<LawFirm>(`/lawfirms/${id}/`)
}

/** Resolves to null when the firm hasn't created a profile yet. */
export async function getMyProfile(): Promise<OwnLawFirm | null> {
  try {
    return await request<OwnLawFirm>('/lawfirms/me/')
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null
    }
    throw error
  }
}

export function saveMyProfile(input: LawFirmInput): Promise<OwnLawFirm> {
  return request<OwnLawFirm>('/lawfirms/me/', { method: 'PUT', json: input })
}

export function listFirmRequests(): Promise<FirmRequest[]> {
  return request<FirmRequest[]>('/lawfirms/me/requests/')
}

export function respondToRequest(id: number, answer: 'accept' | 'decline'): Promise<FirmRequest> {
  return request<FirmRequest>(`/lawfirms/me/requests/${id}/${answer}/`, { method: 'POST' })
}

export function listCaseMatches(caseId: number): Promise<CaseMatch[]> {
  return request<CaseMatch[]>(`/cases/${caseId}/matches/`)
}

export function requestMatch(caseId: number, firm: number, message: string): Promise<CaseMatch> {
  return request<CaseMatch>(`/cases/${caseId}/matches/`, {
    method: 'POST',
    json: { firm, message },
  })
}

/** Withdraws a pending request, or ends an accepted match (which stops sharing the case). */
export function closeMatch(caseId: number, matchId: number): Promise<void> {
  return request<void>(`/cases/${caseId}/matches/${matchId}/`, { method: 'DELETE' })
}
