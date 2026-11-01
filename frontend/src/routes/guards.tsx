import { Navigate, Outlet, useLocation } from 'react-router-dom'
import type { Role } from '@/types'
import { dashboardPath } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { AppShellFallback } from '@/components/layout/AppShell'

export function ProtectedRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <AppShellFallback />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <Outlet />
}

export function PublicOnlyRoute() {
  const { user, loading } = useAuth()
  if (loading) return <AppShellFallback />
  if (user) return <Navigate to={dashboardPath(user.role)} replace />
  return <Outlet />
}

export function RoleRoute({ role }: { role: Role }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== role) return <Navigate to={dashboardPath(user.role)} replace />
  return <Outlet />
}

export function HomeRedirect() {
  const { user, loading } = useAuth()
  if (loading) return <AppShellFallback />
  return <Navigate to={user ? dashboardPath(user.role) : '/login'} replace />
}
