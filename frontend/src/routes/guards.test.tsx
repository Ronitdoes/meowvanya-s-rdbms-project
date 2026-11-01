import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { Role, SessionUser } from '@/types'
import { useAuth } from '@/context/AuthContext'
import { ProtectedRoute, PublicOnlyRoute, RoleRoute } from './guards'

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

const mockedUseAuth = vi.mocked(useAuth)

function makeUser(role: Role): SessionUser {
  return {
    userId: 1,
    email: `${role}@campusconnect.test`,
    role,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function mockAuth(user: SessionUser | null, loading = false) {
  mockedUseAuth.mockReturnValue({
    user,
    loading,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    setUser: vi.fn(),
  })
}

function LoginProbe({ children }: { children?: ReactNode }) {
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  return (
    <div>
      <p>Login page</p>
      {from ? <p>From {from}</p> : null}
      {children}
    </div>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth(null)
})

describe('ProtectedRoute', () => {
  it('redirects signed-out visitors to /login and records where they came from', () => {
    render(
      <MemoryRouter initialEntries={['/student/registrations?tab=upcoming']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/student/registrations" element={<p>Registrations</p>} />
          </Route>
          <Route path="/login" element={<LoginProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Login page')).toBeInTheDocument()
    expect(screen.getByText('From /student/registrations?tab=upcoming')).toBeInTheDocument()
    expect(screen.queryByText('Registrations')).not.toBeInTheDocument()
  })

  it('renders the outlet for a signed-in user', () => {
    mockAuth(makeUser('student'))

    render(
      <MemoryRouter initialEntries={['/student/registrations']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/student/registrations" element={<p>Registrations</p>} />
          </Route>
          <Route path="/login" element={<LoginProbe />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Registrations')).toBeInTheDocument()
  })

  it('shows the app shell fallback while auth is loading', () => {
    mockAuth(null, true)

    render(
      <MemoryRouter>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<p>Secret</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Loading your workspace…')).toBeInTheDocument()
    expect(screen.queryByText('Secret')).not.toBeInTheDocument()
  })
})

describe('PublicOnlyRoute', () => {
  it('renders public pages for signed-out visitors', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<p>Login form</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Login form')).toBeInTheDocument()
  })

  it('redirects a signed-in student to the student dashboard', () => {
    mockAuth(makeUser('student'))

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<p>Login form</p>} />
          </Route>
          <Route path="/student/dashboard" element={<p>Student dashboard</p>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Student dashboard')).toBeInTheDocument()
  })

  it('redirects a signed-in coordinator to the coordinator dashboard', () => {
    mockAuth(makeUser('coordinator'))

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<p>Login form</p>} />
          </Route>
          <Route path="/coordinator/dashboard" element={<p>Coordinator dashboard</p>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Coordinator dashboard')).toBeInTheDocument()
  })
})

describe('RoleRoute', () => {
  it('renders the outlet when the role matches', () => {
    mockAuth(makeUser('admin'))

    render(
      <MemoryRouter initialEntries={['/admin/dashboard']}>
        <Routes>
          <Route element={<RoleRoute role="admin" />}>
            <Route path="/admin/dashboard" element={<p>Admin console</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Admin console')).toBeInTheDocument()
  })

  it('redirects a user with the wrong role to their own dashboard', () => {
    mockAuth(makeUser('student'))

    render(
      <MemoryRouter initialEntries={['/admin/dashboard']}>
        <Routes>
          <Route element={<RoleRoute role="admin" />}>
            <Route path="/admin/dashboard" element={<p>Admin console</p>} />
          </Route>
          <Route path="/student/dashboard" element={<p>Student dashboard</p>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Student dashboard')).toBeInTheDocument()
    expect(screen.queryByText('Admin console')).not.toBeInTheDocument()
  })

  it('redirects signed-out visitors to /login', () => {
    render(
      <MemoryRouter initialEntries={['/admin/dashboard']}>
        <Routes>
          <Route element={<RoleRoute role="admin" />}>
            <Route path="/admin/dashboard" element={<p>Admin console</p>} />
          </Route>
          <Route path="/login" element={<p>Login page</p>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Login page')).toBeInTheDocument()
  })
})
