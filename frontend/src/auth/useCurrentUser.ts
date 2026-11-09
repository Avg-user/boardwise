import { useQuery } from '@tanstack/react-query'
import { getCurrentUser } from '../api/auth.ts'
import { getToken } from '../api/client.ts'
import type { User, UserRole } from '../api/types.ts'
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

export const STAFF_HOME = '/staff'

/** Where a signed-in person lands: staff go to the staff tools, everyone else to their role's home. */
export function getHome(user: Pick<User, 'role' | 'is_staff'>): string {
  return user.is_staff ? STAFF_HOME : ROLE_HOME[user.role]
}
