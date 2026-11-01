import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, CalendarDays, CalendarPlus, SearchX, Ticket, TicketX } from 'lucide-react'
import { toast } from 'sonner'
import { api, errorMessage } from '@/services/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import { cn } from '@/lib/utils'
import type { CampusEvent, Registration, RegistrationSummary } from '@/types'
import { EmptyState, ErrorState, PageHeader, SearchInput } from '@/components/shared/PageChrome'
import { EventCard } from '@/components/shared/EventCard'
import { Pagination } from '@/components/shared/Pagination'
import { Badge } from '@/components/ui/Badge'
import { Button, buttonStyles } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Skeleton'

const PAGE_SIZE = 9

type UpcomingFilter = 'upcoming' | 'all'
type EventState = 'registered' | 'waitlisted' | 'completed' | 'closed' | 'started' | 'deadline' | 'full' | 'open'

interface CancelTarget {
  registrationId: number
  eventId: number
  title: string
}

function toSummary(registration: Registration): RegistrationSummary {
  return {
    registrationId: registration.registrationId,
    status: registration.status,
    registeredAt: registration.registeredAt,
    cancelledAt: registration.cancelledAt ?? null,
    attendanceStatus: registration.attendanceStatus ?? null,
    certificateCode: registration.certificateCode ?? null,
  }
}

function actionState(
  event: CampusEvent,
  registration: RegistrationSummary | null | undefined,
  now: number,
): EventState {
  if (registration?.status === 'confirmed') return 'registered'
  if (registration?.status === 'waitlisted') return 'waitlisted'
  if (event.status === 'completed') return 'completed'
  if (event.status !== 'published') return 'closed'
  if (now >= new Date(event.eventDate).getTime()) return 'started'
  if (now > new Date(event.registrationDeadline).getTime()) return 'deadline'
  if (event.seatsRemaining <= 0 || event.confirmedRegistrations >= event.capacity) return 'full'
  return 'open'
}

export default function StudentEventsPage() {
  usePageTitle('Events')
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [upcoming, setUpcoming] = useState<UpcomingFilter>('upcoming')
  const [page, setPage] = useState(1)
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  const events = useQuery({
    queryKey: ['events', { search: debouncedSearch, upcoming, page }],
    queryFn: () =>
      api.list<CampusEvent>('/events', {
        search: debouncedSearch || undefined,
        upcoming: upcoming === 'upcoming' ? 'true' : 'false',
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  })

  const registrations = useQuery({
    queryKey: ['my-registrations', 'lookup'],
    queryFn: () => api.list<Registration>('/me/registrations', { page: 1, pageSize: 100 }),
  })

  const summaryByEvent = useMemo(() => {
    const map = new Map<number, RegistrationSummary>()
    for (const registration of registrations.data?.data ?? []) {
      map.set(registration.eventId, toSummary(registration))
    }
    return map
  }, [registrations.data])

  const invalidateRegistrationData = (eventId: number) => {
    void queryClient.invalidateQueries({ queryKey: ['events'] })
    void queryClient.invalidateQueries({ queryKey: ['my-registrations'] })
    void queryClient.invalidateQueries({ queryKey: ['student-dashboard'] })
    void queryClient.invalidateQueries({ queryKey: ['event', eventId] })
  }

  const register = useMutation({
    mutationFn: (event: CampusEvent) => api.post<Registration>(`/events/${event.eventId}/register`),
    onSuccess: (registration) => {
      toast.success('Seat confirmed', {
        description: `You are registered for ${registration.eventTitle}.`,
      })
      invalidateRegistrationData(registration.eventId)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const cancel = useMutation({
    mutationFn: (target: CancelTarget) => api.delete(`/registrations/${target.registrationId}`),
    onSuccess: (_result, target) => {
      toast.success('Registration cancelled', {
        description: `Your seat for ${target.title} has been released.`,
      })
      setCancelTarget(null)
      invalidateRegistrationData(target.eventId)
    },
    onError: (error) => {
      toast.error(errorMessage(error))
      setCancelTarget(null)
    },
  })

  const now = Date.now()

  const changeSearch = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  const changeUpcoming = (value: UpcomingFilter) => {
    setUpcoming(value)
    setPage(1)
  }

  const clearFilters = () => {
    setSearch('')
    setPage(1)
  }

  const renderActions = (event: CampusEvent) => {
    const summary = summaryByEvent.get(event.eventId) ?? event.myRegistration ?? null
    const state = actionState(event, summary, now)
    const registering = register.isPending && register.variables?.eventId === event.eventId
    const cancelling = cancel.isPending && cancel.variables?.registrationId === summary?.registrationId

    switch (state) {
      case 'registered':
        return (
          <Button
            size="sm"
            variant="secondary"
            loading={cancelling}
            leftIcon={<TicketX className="h-3.5 w-3.5" />}
            onClick={() => {
              if (!summary) return
              setCancelTarget({
                registrationId: summary.registrationId,
                eventId: event.eventId,
                title: event.title,
              })
            }}
          >
            Cancel spot
          </Button>
        )
      case 'open':
        return (
          <Button
            size="sm"
            loading={registering}
            leftIcon={<Ticket className="h-3.5 w-3.5" />}
            onClick={() => register.mutate(event)}
          >
            Register
          </Button>
        )
      case 'waitlisted':
        return <Badge tone="warning">Waitlisted</Badge>
      case 'full':
        return <Badge tone="danger">Full</Badge>
      case 'deadline':
        return <Badge tone="neutral">Deadline passed</Badge>
      case 'started':
        return <Badge tone="neutral">Event started</Badge>
      case 'completed':
        return <Badge tone="neutral">Completed</Badge>
      default:
        return <Badge tone="neutral">Not open</Badge>
    }
  }

  const rows = events.data?.data ?? []
  const total = events.data?.meta.total ?? 0

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Student portal"
        title="Events on campus"
        description="Discover what your clubs are hosting, reserve a seat, and keep track of everything you are going to."
        actions={
          <Link to="/student/registrations" className={buttonStyles({ variant: 'secondary' })}>
            My registrations <ArrowRight className="h-4 w-4" />
          </Link>
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SearchInput
          value={search}
          onChange={changeSearch}
          placeholder="Search events, clubs or venues…"
          className="w-full lg:max-w-sm"
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:justify-end">
          <div
            className="inline-flex w-fit rounded-full border border-ink-200 bg-white p-1 shadow-sm"
            role="tablist"
            aria-label="Filter events by date"
          >
            {([
              { value: 'upcoming', label: 'Upcoming' },
              { value: 'all', label: 'All dates' },
            ] as const).map((option) => {
              const active = option.value === upcoming
              return (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => changeUpcoming(option.value)}
                  className={cn(
                    'rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors',
                    active ? 'bg-ink-950 text-white shadow-sm' : 'text-ink-500 hover:text-ink-800',
                  )}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-ink-400">
            {events.data
              ? `${total} ${total === 1 ? 'event' : 'events'} ${upcoming === 'upcoming' ? 'coming up' : 'in total'}`
              : 'Published events only'}
          </p>
        </div>
      </div>

      {events.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-80 rounded-3xl" />
          ))}
        </div>
      ) : events.isError ? (
        <ErrorState
          title="We could not load the events"
          message={errorMessage(events.error)}
          onRetry={() => events.refetch()}
        />
      ) : rows.length > 0 ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((event) => {
              const summary = summaryByEvent.get(event.eventId) ?? event.myRegistration ?? null
              return (
                <EventCard
                  key={event.eventId}
                  event={summary ? { ...event, myRegistration: summary } : event}
                  to={`/student/events/${event.eventId}`}
                  className="animate-fade-up"
                  actions={renderActions(event)}
                />
              )
            })}
          </div>
          <Pagination meta={events.data?.meta} onPageChange={setPage} label="events" />
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={debouncedSearch ? <SearchX className="h-6 w-6" /> : <CalendarPlus className="h-6 w-6" />}
            title={
              debouncedSearch
                ? 'No events match that search'
                : upcoming === 'upcoming'
                  ? 'Nothing coming up right now'
                  : 'No events published yet'
            }
            description={
              debouncedSearch
                ? 'Try a different title, club or venue — or clear the search to see everything that is open.'
                : upcoming === 'upcoming'
                  ? 'New events are published throughout the term. Take a look at past events, or check back soon.'
                  : 'Once coordinators publish events they will appear here for you to register.'
            }
            action={
              debouncedSearch ? (
                <Button size="sm" variant="secondary" onClick={clearFilters}>
                  Clear search
                </Button>
              ) : upcoming === 'upcoming' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => changeUpcoming('all')}
                  leftIcon={<CalendarDays className="h-3.5 w-3.5" />}
                >
                  Show all dates
                </Button>
              ) : (
                <Link to="/student/clubs" className={buttonStyles({ size: 'sm', variant: 'secondary' })}>
                  Explore clubs
                </Link>
              )
            }
          />
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        onConfirm={() => {
          if (cancelTarget) cancel.mutate(cancelTarget)
        }}
        title="Release your seat?"
        description={
          cancelTarget ? (
            <>
              You are about to cancel your registration for <span className="font-semibold text-ink-800">{cancelTarget.title}</span>.
              Your seat will be offered to another student.
            </>
          ) : undefined
        }
        confirmLabel="Cancel registration"
        cancelLabel="Keep my seat"
        tone="danger"
        loading={cancel.isPending}
      />
    </div>
  )
}
