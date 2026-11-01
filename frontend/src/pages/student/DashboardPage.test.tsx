import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { CampusEvent, MembershipRequest, Registration, SessionUser, StudentDashboard } from '@/types'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/services/api'
import StudentDashboardPage from './DashboardPage'

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('@/services/api', () => ({
  api: { get: vi.fn() },
}))

const mockedUseAuth = vi.mocked(useAuth)
const mockedGet = vi.mocked(api.get as unknown as (path: string) => Promise<unknown>)

const user: SessionUser = {
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

const upcomingEvent: CampusEvent = {
  eventId: 7,
  clubId: 2,
  clubName: 'Robotics Club',
  venueId: 1,
  venueName: 'Main Auditorium',
  venueCapacity: 300,
  title: 'Spring Hackathon',
  description: 'Build something bold in twenty-four hours.',
  eventDate: '2099-03-14T09:00:00.000Z',
  registrationDeadline: '2099-03-10T18:00:00.000Z',
  capacity: 50,
  status: 'published',
  createdAt: '2099-01-05T10:00:00.000Z',
  updatedAt: '2099-01-06T10:00:00.000Z',
  confirmedRegistrations: 20,
  totalRegistrations: 24,
  seatsRemaining: 30,
  averageRating: 4.5,
  feedbackCount: 8,
  myRegistration: {
    registrationId: 31,
    status: 'confirmed',
    registeredAt: '2099-02-01T09:00:00.000Z',
  },
}

const registration: Registration = {
  registrationId: 31,
  studentId: 1,
  eventId: 7,
  studentName: 'Priya Sharma',
  email: 'student01@campusconnect.test',
  enrollmentNumber: 'CS-2024-001',
  departmentName: 'Computer Science',
  clubName: 'Robotics Club',
  eventTitle: 'Spring Hackathon',
  eventDate: '2099-03-14T09:00:00.000Z',
  venueName: 'Main Auditorium',
  status: 'confirmed',
  registeredAt: '2099-02-01T09:00:00.000Z',
}

const dashboard: StudentDashboard = {
  clubsJoined: 2,
  approvedMemberships: 4,
  pendingMemberships: 3,
  eventsRegistered: 7,
  upcomingRegistrations: 5,
  certificatesEarned: 2,
  upcomingEvents: [upcomingEvent],
  recentRegistrations: [registration],
}

const memberships: MembershipRequest[] = [
  {
    membershipId: 11,
    clubId: 2,
    clubName: 'Robotics Club',
    status: 'approved',
    role: 'member',
    requestedAt: '2099-01-10T09:00:00.000Z',
    decidedAt: '2099-01-12T09:00:00.000Z',
    joinedAt: '2099-01-12T09:00:00.000Z',
  },
]

function useDashboardFixtures(overrides: { dashboard?: StudentDashboard | null; memberships?: MembershipRequest[] } = {}) {
  const dashboardFixture = overrides.dashboard === undefined ? dashboard : overrides.dashboard
  const membershipFixture = overrides.memberships ?? memberships
  mockedGet.mockImplementation((path: string) => {
    if (path === '/me/dashboard') {
      return dashboardFixture === null ? Promise.reject(new Error('Server unavailable')) : Promise.resolve(dashboardFixture)
    }
    if (path === '/me/memberships') return Promise.resolve(membershipFixture)
    return Promise.reject(new Error(`Unexpected API path: ${path}`))
  })
}

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/student/dashboard']}>
        <StudentDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function statCard(label: string): HTMLElement {
  // "Certificates" also appears in the hero, so prefer the last matching label (the bottom stat grid).
  const labelNode = screen.getAllByText(label, { selector: 'p' }).at(-1)
  const card = labelNode?.parentElement?.parentElement
  if (!labelNode || !card) throw new Error(`Stat card for "${label}" was not found`)
  return card
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedUseAuth.mockReturnValue({
    user,
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    setUser: vi.fn(),
  })
  useDashboardFixtures()
})

describe('StudentDashboardPage', () => {
  it('greets the signed-in student and shows dashboard stats', async () => {
    renderDashboard()

    expect(
      await screen.findByRole('heading', { level: 1, name: /Good (morning|afternoon|evening), Priya\./ }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Here is what is happening across your clubs/)).toBeInTheDocument()

    // Wait for the dashboard fixture to populate before checking the stat grid.
    await screen.findByRole('link', { name: 'Spring Hackathon' })

    expect(within(statCard('Approved clubs')).getByText('4')).toBeInTheDocument()
    expect(within(statCard('Pending requests')).getByText('3')).toBeInTheDocument()
    expect(within(statCard('Events registered')).getByText('7')).toBeInTheDocument()
    expect(within(statCard('Certificates')).getByText('2')).toBeInTheDocument()
  })

  it('shows the next upcoming event and recent registration', async () => {
    renderDashboard()

    expect(await screen.findByText(/Next up:/)).toBeInTheDocument()
    const titleLink = screen.getByRole('link', { name: 'Spring Hackathon' })
    expect(titleLink).toHaveAttribute('href', '/student/events/7')
    expect(screen.getByText('Main Auditorium')).toBeInTheDocument()
    expect(screen.getByText('20 / 50 seats')).toBeInTheDocument()
    expect(screen.getByText('Registered')).toBeInTheDocument()
    expect(screen.getByText('Your latest event sign-ups.')).toBeInTheDocument()
  })

  it('shows club memberships and their status', async () => {
    renderDashboard()

    expect(await screen.findByText('Your clubs')).toBeInTheDocument()
    const rows = await screen.findAllByText('Robotics Club')
    expect(rows.length).toBeGreaterThan(0)
    expect(screen.getByText('member')).toBeInTheDocument()
    expect(screen.getByText('approved')).toBeInTheDocument()
  })

  it('shows empty states when there are no events, registrations or memberships', async () => {
    useDashboardFixtures({
      dashboard: {
        clubsJoined: 0,
        approvedMemberships: 0,
        pendingMemberships: 0,
        eventsRegistered: 0,
        upcomingRegistrations: 0,
        certificatesEarned: 0,
        upcomingEvents: [],
        recentRegistrations: [],
      },
      memberships: [],
    })
    renderDashboard()

    expect(await screen.findByText('No upcoming events yet')).toBeInTheDocument()
    expect(screen.getByText('No registrations yet')).toBeInTheDocument()
    expect(screen.getByText('No memberships yet')).toBeInTheDocument()
    expect(screen.getByText(/Your next campus/)).toBeInTheDocument()
  })

  it('shows an error state with retry when the dashboard request fails', async () => {
    useDashboardFixtures({ dashboard: null })
    renderDashboard()

    expect(await screen.findByText('We could not load your dashboard')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument()
  })
})
