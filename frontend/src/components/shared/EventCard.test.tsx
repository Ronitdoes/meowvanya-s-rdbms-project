import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { CampusEvent } from '@/types'
import { EventCard } from './EventCard'

const event: CampusEvent = {
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

function renderCard(overrides: Partial<CampusEvent> = {}, to: string | undefined = '/student/events/7') {
  return render(
    <MemoryRouter>
      <EventCard event={{ ...event, ...overrides }} to={to} />
    </MemoryRouter>,
  )
}

describe('EventCard', () => {
  it('renders the club, title, description and venue', () => {
    renderCard()

    expect(screen.getByText('Robotics Club')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Spring Hackathon' })).toBeInTheDocument()
    expect(screen.getByText('Build something bold in twenty-four hours.')).toBeInTheDocument()
    expect(screen.getByText('Main Auditorium')).toBeInTheDocument()
    expect(screen.getByText('published')).toBeInTheDocument()
  })

  it('links the title to the provided destination', () => {
    renderCard()

    expect(screen.getByRole('link', { name: 'Spring Hackathon' })).toHaveAttribute('href', '/student/events/7')
  })

  it('shows the registered badge for a confirmed registration', () => {
    renderCard()

    expect(screen.getByText('Registered')).toBeInTheDocument()
  })

  it('does not show the registered badge for other registration states', () => {
    renderCard({ myRegistration: { registrationId: 31, status: 'waitlisted', registeredAt: '2099-02-01T09:00:00.000Z' } })

    expect(screen.queryByText('Registered')).not.toBeInTheDocument()
  })

  it('shows capacity and attendance text', () => {
    renderCard()

    expect(screen.getByText('20 / 50 seats')).toBeInTheDocument()
    expect(screen.getByText('30 left')).toBeInTheDocument()
    expect(screen.getByText('20 going')).toBeInTheDocument()
  })

  it('renders the title as plain text when no destination is given', () => {
    renderCard({}, undefined)

    expect(screen.queryByRole('link', { name: 'Spring Hackathon' })).not.toBeInTheDocument()
    expect(screen.getByText('Spring Hackathon')).toBeInTheDocument()
  })

  it('renders provided actions', () => {
    render(
      <MemoryRouter>
        <EventCard event={event} to="/student/events/7" actions={<button type="button">Register</button>} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: 'Register' })).toBeInTheDocument()
  })
})
