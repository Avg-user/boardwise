const API_BASE = '/api'
const TOKEN_KEY = 'boardwise.token'

// sessionStorage clears when the browser closes, which matters on shared computers.
export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token)
  } catch {
    // Without storage the person has to sign in again on their next request.
  }
}

export function clearToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // Nothing was stored.
  }
}

export class ApiError extends Error {
  status: number
  /** The parsed error body, such as `{ detail }` or per-field validation errors. */
  data: unknown

  constructor(status: number, data: unknown) {
    super(`API request failed with status ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Sent as a JSON body. */
  json?: unknown
  /** Sent as multipart form data. The browser sets the boundary header. */
  form?: FormData
  /** Set to false for login, because the API rejects a stale token even with the right password. */
  auth?: boolean
  signal?: AbortSignal
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const { method = 'GET', json, form, auth = true, signal } = options
  const headers = new Headers()
  const token = auth ? getToken() : null
  if (token) {
    headers.set('Authorization', `Token ${token}`)
  }
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: json !== undefined ? JSON.stringify(json) : form,
    signal,
    // Auth uses the token only. An admin session cookie would trigger CSRF failures.
    credentials: 'omit',
  })

  if (!response.ok) {
    if (response.status === 401 && token) {
      clearToken()
    }
    const data: unknown = await response.json().catch(() => null)
    throw new ApiError(response.status, data)
  }
  return response
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options)
  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

export async function requestBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  const response = await send(path, options)
  return response.blob()
}
