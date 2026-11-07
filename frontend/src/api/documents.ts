import { request, requestBlob } from './client.ts'
import type { CaseDocument } from './types.ts'

export function listDocuments(caseId: number): Promise<CaseDocument[]> {
  return request<CaseDocument[]>(`/cases/${caseId}/documents/`)
}

export function uploadDocument(caseId: number, file: File): Promise<CaseDocument> {
  const form = new FormData()
  form.append('file', file)
  return request<CaseDocument>(`/cases/${caseId}/documents/`, { method: 'POST', form })
}

/** Downloads need the auth token, so fetch the file here instead of linking to its URL. */
export function downloadDocument(caseId: number, documentId: number): Promise<Blob> {
  return requestBlob(`/cases/${caseId}/documents/${documentId}/download/`)
}

export function deleteDocument(caseId: number, documentId: number): Promise<void> {
  return request<void>(`/cases/${caseId}/documents/${documentId}/`, { method: 'DELETE' })
}
