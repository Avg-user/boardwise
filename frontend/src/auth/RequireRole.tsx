import { Navigate, Outlet } from 'react-router-dom'
import type { UserRole } from '../api/types.ts'
import { getHome, STAFF_HOME, useCurrentUser } from './useCurrentUser.ts'

/**
 * Sends people to their own home if a page isn't meant for them. Staff only use the staff tools.
 * This only shapes the UI; the API enforces access on its own. Use inside RequireAuth, so the
 * user is already loaded.
 */
function RequireRole({ roles }: { roles: UserRole[] }) {
  const { user } = useCurrentUser()
  if (user?.is_staff) {
    return <Navigate to={STAFF_HOME} replace />
  }
  if (user && !roles.includes(user.role)) {
    return <Navigate to={getHome(user)} replace />
  }
  return <Outlet />
}

/** The staff tools. Everyone else goes to their own home. */
export function RequireStaff() {
  const { user } = useCurrentUser()
  if (user && !user.is_staff) {
    return <Navigate to={getHome(user)} replace />
  }
  return <Outlet />
}

export default RequireRole
