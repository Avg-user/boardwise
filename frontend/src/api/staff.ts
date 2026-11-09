import { request } from './client.ts'

// Staff tools (apps/staff). Staff-only on the server; others get 403.

export type VerifyStatus = 'pending' | 'verified' | 'all'

export type StaffOverview = {
  firms: { pending: number; verified: number }
  companies: { pending: number; verified: number }
  accounts: { victim: number; hr: number; law_firm: number }
}

export type StaffFirm = {
  id: number
  name: string
  tagline: string
  city: string
  provinces: string[]
  practice_areas: string[]
  website: string
  email: string
  phone: string
  law_society_number: string
  accepting_clients: boolean
  is_verified: boolean
  verified_at: string | null
  verified_by: string | null
  is_listed: boolean
  /** Profile fields still empty, e.g. "description". */
  missing: string[]
  /** The firm's Boardwise username. */
  account: string
  created_at: string
  updated_at: string
}

export type StaffCompany = {
  id: number
  name: string
  province: string
  city: string
  is_verified: boolean
  verified_at: string | null
  verified_by: string | null
  hr_accounts: string[]
  created_at: string
}

export type StaffKind = 'firms' | 'companies'

function query(status: VerifyStatus, q: string): string {
  const params = new URLSearchParams({ status })
  if (q.trim()) params.set('q', q.trim())
  return params.toString()
}

export function getOverview(): Promise<StaffOverview> {
  return request<StaffOverview>('/staff/overview/')
}

export function listStaffFirms(status: VerifyStatus, q = ''): Promise<StaffFirm[]> {
  return request<StaffFirm[]>(`/staff/firms/?${query(status, q)}`)
}

export function listStaffCompanies(status: VerifyStatus, q = ''): Promise<StaffCompany[]> {
  return request<StaffCompany[]>(`/staff/companies/?${query(status, q)}`)
}

export function setVerified(kind: StaffKind, id: number, verified: boolean): Promise<StaffFirm | StaffCompany> {
  return request(`/staff/${kind}/${id}/${verified ? 'verify' : 'unverify'}/`, { method: 'POST' })
}
