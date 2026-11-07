import { Navigate, Outlet } from 'react-router-dom'
import type { UserRole } from '../api/types.ts'
import { getRoleHome, useCurrentUser } from './useCurrentUser.ts'

/**
 * Sends people to their own home if a page isn't meant for their role. This only shapes the UI;
 * the API enforces access on its own. Use inside RequireAuth, so the user is already loaded.
 */
function RequireRole({ roles }: { roles: UserRole[] }) {
  const { user } = useCurrentUser()
  if (user && !roles.includes(user.role)) {
    return <Navigate to={getRoleHome(user.role)} replace />
  }
  return <Outlet />
}

export default RequireRole
