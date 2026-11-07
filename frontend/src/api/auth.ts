import { clearToken, request, setToken } from './client.ts'
import type { LoginResponse, User, UserRole } from './types.ts'

export async function login(username: string, password: string): Promise<User> {
  const { token, user } = await request<LoginResponse>('/auth/login/', {
    method: 'POST',
    json: { username, password },
    auth: false,
  })
  setToken(token)
  return user
}

export type SignupInput = {
  username: string
  password: string
  role: UserRole
  preferred_language: string
}

// PROPOSED: the backend has no signup route yet, so this currently returns a 404.
// The expected response is the same as login.
export async function signup(input: SignupInput): Promise<User> {
  const { token, user } = await request<LoginResponse>('/auth/register/', {
    method: 'POST',
    json: input,
    auth: false,
  })
  setToken(token)
  return user
}

/** Follow with a full page reload, so cached case data doesn't outlive the session. */
export async function logout(): Promise<void> {
  try {
    await request<void>('/auth/logout/', { method: 'POST' })
  } finally {
    // Sign out on this device even if the server can't be reached.
    clearToken()
  }
}

export function getCurrentUser(): Promise<User> {
  return request<User>('/auth/me/')
}

export function updateCurrentUser(changes: Pick<User, 'preferred_language'>): Promise<User> {
  return request<User>('/auth/me/', { method: 'PATCH', json: changes })
}
