import { useQuery } from '@tanstack/react-query'
import { getCurrentUser } from '../api/auth.ts'
import { getToken } from '../api/client.ts'
import type { UserRole } from '../api/types.ts'
import { CURRENT_USER_KEY } from '../queryClient.ts'

export function useCurrentUser() {
  const { data, isLoading } = useQuery({
    queryKey: CURRENT_USER_KEY,
    queryFn: getCurrentUser,
    enabled: Boolean(getToken()),
  })
  return { user: data ?? null, isLoading }
}

const ROLE_HOME: Record<UserRole, string> = {
  victim: '/',
  hr: '/hr',
  law_firm: '/firm',
}

export function getRoleHome(role: UserRole): string {
  return ROLE_HOME[role]
}
