import { request } from './client.ts'
import type { Case, CaseStatus, TimelineEntry, TimelineEntryInput } from './types.ts'

export function listCases(): Promise<Case[]> {
  return request<Case[]>('/cases/')
}

export function getCase(caseId: number): Promise<Case> {
  return request<Case>(`/cases/${caseId}/`)
}

export function createCase(title: string): Promise<Case> {
  return request<Case>('/cases/', { method: 'POST', json: { title } })
}

export function updateCase(
  caseId: number,
  changes: { title?: string; status?: CaseStatus },
): Promise<Case> {
  return request<Case>(`/cases/${caseId}/`, { method: 'PATCH', json: changes })
}

export function deleteCase(caseId: number): Promise<void> {
  return request<void>(`/cases/${caseId}/`, { method: 'DELETE' })
}

export function listTimeline(caseId: number): Promise<TimelineEntry[]> {
  return request<TimelineEntry[]>(`/cases/${caseId}/timeline/`)
}

export function createTimelineEntry(
  caseId: number,
  entry: TimelineEntryInput,
): Promise<TimelineEntry> {
  return request<TimelineEntry>(`/cases/${caseId}/timeline/`, { method: 'POST', json: entry })
}

export function updateTimelineEntry(
  caseId: number,
  entryId: number,
  changes: Partial<TimelineEntryInput>,
): Promise<TimelineEntry> {
  return request<TimelineEntry>(`/cases/${caseId}/timeline/${entryId}/`, {
    method: 'PATCH',
    json: changes,
  })
}

export function deleteTimelineEntry(caseId: number, entryId: number): Promise<void> {
  return request<void>(`/cases/${caseId}/timeline/${entryId}/`, { method: 'DELETE' })
}
