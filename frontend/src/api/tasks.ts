import { request } from './client.ts'
import type { Task, TaskInput } from './types.ts'

/** The cache key for a case's checklist, shared by the panel and the PDF export. */
export const tasksQueryKey = (caseId: number) => ['cases', caseId, 'tasks']

export function listTasks(caseId: number): Promise<Task[]> {
  return request<Task[]>(`/cases/${caseId}/tasks/`)
}

export function createTask(caseId: number, task: TaskInput): Promise<Task> {
  return request<Task>(`/cases/${caseId}/tasks/`, { method: 'POST', json: task })
}

export function updateTask(
  caseId: number,
  taskId: number,
  changes: Partial<TaskInput>,
): Promise<Task> {
  return request<Task>(`/cases/${caseId}/tasks/${taskId}/`, { method: 'PATCH', json: changes })
}

export function deleteTask(caseId: number, taskId: number): Promise<void> {
  return request<void>(`/cases/${caseId}/tasks/${taskId}/`, { method: 'DELETE' })
}
