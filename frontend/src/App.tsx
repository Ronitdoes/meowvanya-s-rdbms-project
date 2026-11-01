import { lazy, Suspense, useEffect } from 'react'
import type { ReactNode } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { AppShell, AppShellFallback } from '@/components/layout/AppShell'
import { HomeRedirect, ProtectedRoute, PublicOnlyRoute, RoleRoute } from '@/routes/guards'

const LoginPage = lazy(() => import('@/pages/auth/LoginPage'))
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage'))
const ProfilePage = lazy(() => import('@/pages/ProfilePage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))
const StudentDashboardPage = lazy(() => import('@/pages/student/DashboardPage'))
const StudentClubsPage = lazy(() => import('@/pages/student/ClubsPage'))
const StudentClubDetailPage = lazy(() => import('@/pages/student/ClubDetailPage'))
const StudentEventsPage = lazy(() => import('@/pages/student/EventsPage'))
const StudentEventDetailPage = lazy(() => import('@/pages/student/EventDetailPage'))
const StudentRegistrationsPage = lazy(() => import('@/pages/student/RegistrationsPage'))
const StudentCertificatesPage = lazy(() => import('@/pages/student/CertificatesPage'))
const CoordinatorDashboardPage = lazy(() => import('@/pages/coordinator/DashboardPage'))
const CoordinatorEventsPage = lazy(() => import('@/pages/coordinator/EventsPage'))
const CoordinatorEventFormPage = lazy(() => import('@/pages/coordinator/EventFormPage'))
const CoordinatorMembersPage = lazy(() => import('@/pages/coordinator/MembersPage'))
const CoordinatorAttendancePage = lazy(() => import('@/pages/coordinator/AttendancePage'))
const AdminDashboardPage = lazy(() => import('@/pages/admin/DashboardPage'))
const AdminStudentsPage = lazy(() => import('@/pages/admin/StudentsPage'))
const AdminClubsPage = lazy(() => import('@/pages/admin/ClubsPage'))
const AdminEventsPage = lazy(() => import('@/pages/admin/EventsPage'))
const AdminVenuesPage = lazy(() => import('@/pages/admin/VenuesPage'))
const AdminDepartmentsPage = lazy(() => import('@/pages/admin/DepartmentsPage'))

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname])
  return null
}

function SuspensePage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<AppShellFallback />}>{children}</Suspense>
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <SuspensePage>
        <Routes>
          <Route path="/" element={<HomeRedirect />} />

          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
          </Route>

          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route path="/profile" element={<ProfilePage />} />

              <Route path="/student" element={<RoleRoute role="student" />}>
                <Route path="dashboard" element={<StudentDashboardPage />} />
                <Route path="clubs" element={<StudentClubsPage />} />
                <Route path="clubs/:id" element={<StudentClubDetailPage />} />
                <Route path="events" element={<StudentEventsPage />} />
                <Route path="events/:id" element={<StudentEventDetailPage />} />
                <Route path="registrations" element={<StudentRegistrationsPage />} />
                <Route path="certificates" element={<StudentCertificatesPage />} />
              </Route>

              <Route path="/coordinator" element={<RoleRoute role="coordinator" />}>
                <Route path="dashboard" element={<CoordinatorDashboardPage />} />
                <Route path="events" element={<CoordinatorEventsPage />} />
                <Route path="events/new" element={<CoordinatorEventFormPage />} />
                <Route path="events/:id/edit" element={<CoordinatorEventFormPage />} />
                <Route path="events/:id/attendance" element={<CoordinatorAttendancePage />} />
                <Route path="members" element={<CoordinatorMembersPage />} />
              </Route>

              <Route path="/admin" element={<RoleRoute role="admin" />}>
                <Route path="dashboard" element={<AdminDashboardPage />} />
                <Route path="students" element={<AdminStudentsPage />} />
                <Route path="clubs" element={<AdminClubsPage />} />
                <Route path="events" element={<AdminEventsPage />} />
                <Route path="venues" element={<AdminVenuesPage />} />
                <Route path="departments" element={<AdminDepartmentsPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </SuspensePage>
    </>
  )
}
