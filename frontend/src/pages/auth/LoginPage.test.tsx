import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { SessionUser } from '@/types'
import { ApiError } from '@/services/api'
import { useAuth } from '@/context/AuthContext'
import LoginPage from './LoginPage'

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

const mockedUseAuth = vi.mocked(useAuth)

const student: SessionUser = {
  userId: 1,
  email: 'student01@campusconnect.test',
  role: 'student',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  student: {
    studentId: 1,
    userId: 1,
    email: 'student01@campusconnect.test',
    fullName: 'Priya Sharma',
    enrollmentNumber: 'CS-2024-001',
    departmentId: 2,
    departmentName: 'Computer Science',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
}

const loginMock = vi.fn<(input: { email: string; password: string }) => Promise<SessionUser>>()

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <LoginPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedUseAuth.mockReturnValue({
    user: null,
    loading: false,
    login: loginMock,
    register: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    setUser: vi.fn(),
  })
})

describe('LoginPage', () => {
  it('shows validation errors for an empty submit without calling login', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Email is required.')).toBeInTheDocument()
    expect(screen.getByText('Password is required.')).toBeInTheDocument()
    expect(loginMock).not.toHaveBeenCalled()
  })

  it('rejects a malformed email address', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.type(screen.getByLabelText('Email address'), 'not-an-email')
    await user.type(screen.getByLabelText('Password'), 'Password123!')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument()
    expect(loginMock).not.toHaveBeenCalled()
  })

  it('fills the form from a demo account button', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.click(screen.getByRole('button', { name: /student01@campusconnect\.test/i }))

    expect(screen.getByLabelText('Email address')).toHaveValue('student01@campusconnect.test')
    expect(screen.getByLabelText('Password')).toHaveValue('Password123!')
  })

  it('logs in and navigates to the role dashboard', async () => {
    const user = userEvent.setup()
    loginMock.mockResolvedValue(student)
    renderLogin()

    await user.type(screen.getByLabelText('Email address'), 'student01@campusconnect.test')
    await user.type(screen.getByLabelText('Password'), 'Password123!')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() =>
      expect(loginMock).toHaveBeenCalledWith({
        email: 'student01@campusconnect.test',
        password: 'Password123!',
      }),
    )
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/student/dashboard', { replace: true }),
    )
  })

  it('shows the API error message when login fails', async () => {
    const user = userEvent.setup()
    loginMock.mockRejectedValue(new ApiError(401, 'invalid_credentials', 'Email or password is incorrect.'))
    renderLogin()

    await user.type(screen.getByLabelText('Email address'), 'student01@campusconnect.test')
    await user.type(screen.getByLabelText('Password'), 'WrongPassword1!')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Email or password is incorrect.')
    expect(navigateMock).not.toHaveBeenCalled()
  })
})
