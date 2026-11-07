import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { ApiError } from './api/client.ts'
import type { User } from './api/types.ts'

export const CURRENT_USER_KEY = ['currentUser']

/** Forgets all cached case data, so it can't outlive the session on a shared computer. */
export function clearSession() {
  queryClient.setQueryData<User | null>(CURRENT_USER_KEY, null)
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== CURRENT_USER_KEY[0] })
}

function handleApiError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    clearSession()
  }
}

export const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleApiError }),
  mutationCache: new MutationCache({ onError: handleApiError }),
  defaultOptions: {
    queries: {
      // Retrying won't fix a 4xx, such as a case the person can't access.
      retry: (failureCount, error) =>
        failureCount < 1 && !(error instanceof ApiError && error.status < 500),
    },
  },
})
