import { useDeferredValue, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarPlus,
  ClipboardCheck,
  Clock3,
  Info,
  MapPin,
  Pencil,
  Trash2,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError, errorMessage } from '@/services/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import { cn, formatDate, formatTime, pluralize } from '@/lib/utils'
import type { CampusEvent, EventStatus, PaginationMeta } from '@/types'
import { EmptyState, ErrorState, PageHeader, SearchInput } from '@/components/shared/PageChrome'
import { CapacityBar } from '@/components/shared/CapacityBar'
import { Pagination } from '@/components/shared/Pagination'
import { StatusBadge } from '@/components/ui/Badge'
import { Button, buttonStyles } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Skeleton'

type StatusTab = 'all' | EventStatus

const statusTabs: Array<{ value: StatusTab; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Pending' },
  { value: 'published', label: 'Published' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

interface ManagedEventsPage {
  events: CampusEvent[]
  meta: PaginationMeta
  fallback: boolean
}

interface ManagedEventsParams {
  status: StatusTab
  search: string
  page: number
  pageSize: number
}

/**
 * The backend may not expose a dedicated `/coordinator/events` collection yet.
 * Try it first and fall back to the documented `/events?scope=managed` listing.
 */
async function fetchManagedEvents({
  status,
  search,
  page,
  pageSize,
}: ManagedEventsParams): Promise<ManagedEventsPage> {
  try {
    const result = await api.list<CampusEvent>('/coordinator/events', {
      status: status === 'all' ? undefined : status,
      search,
      page,
      pageSize,
    })
    return { events: result.data, meta: result.meta, fallback: false }
  } catch (error) {
    if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 405)) {
      throw error
    }
  }

  const all = await api.list<CampusEvent>('/events', {
    scope: 'managed',
    upcoming: false,
    search,
    page: 1,
    pageSize: 100,
  })
  const filtered = status === 'all' ? all.data : all.data.filter((event) => event.status === status)
  const start = (page - 1) * pageSize
  return {
    events: filtered.slice(start, start + pageSize),
    meta: {
      page,
      pageSize,
      total: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
    },
    fallback: true,
  }
}

export default function CoordinatorEventsPage() {
  usePageTitle('My events')
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [status, setStatus] = useState<StatusTab>('all')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [page, setPage] = useState(1)
  const [eventToDelete, setEventToDelete] = useState<CampusEvent | null>(null)

  const events = useQuery({
    queryKey: ['managed-events', status, deferredSearch, page],
    queryFn: () =>
      fetchManagedEvents({
        status,
        search: deferredSearch,
        page,
        pageSize: 9,
      }),
    placeholderData: keepPreviousData,
  })

  const remove = useMutation({
    mutationFn: (event: CampusEvent) => api.delete(`/events/${event.eventId}`),
    onSuccess: (_result, event) => {
      toast.success(`"${event.title}" was deleted`)
      setEventToDelete(null)
      void queryClient.invalidateQueries({ queryKey: ['managed-events'] })
      void queryClient.invalidateQueries({ queryKey: ['coordinator-dashboard'] })
    },
    onError: (error) => {
      toast.error(errorMessage(error))
      setEventToDelete(null)
    },
  })

  const changeStatus = (next: StatusTab) => {
    setStatus(next)
    setPage(1)
  }

  const changeSearch = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  const rows = events.data?.events ?? []
  const meta = events.data?.meta
  const showSkeleton = events.isLoading && !events.data

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Coordinator studio"
        title="My events"
        description="Create events, watch registrations and mark attendance for the clubs you coordinate."
        actions={
          <Link to="/coordinator/events/new" className={buttonStyles({})}>
            <CalendarPlus className="h-4 w-4" /> Create event
          </Link>
        }
      />

      <div className="flex items-start gap-2.5 rounded-2xl border border-sky-200 bg-sky-50/70 px-4 py-3 text-[0.8125rem] leading-relaxed text-sky-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          New events are submitted as <span className="font-semibold">pending</span> and become visible to
          students once an administrator publishes them. Editing an event never changes its status.
        </p>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 no-scrollbar" role="tablist" aria-label="Event status">
          {statusTabs.map((tab) => {
            const active = tab.value === status
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => changeStatus(tab.value)}
                className={cn(
                  'shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold transition-colors',
                  active
                    ? 'bg-ink-950 text-white shadow-sm'
                    : 'border border-ink-200 bg-white text-ink-500 hover:border-ink-300 hover:text-ink-800',
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
        <SearchInput
          value={search}
          onChange={changeSearch}
          placeholder="Search title, club or venue…"
          className="w-full lg:w-80"
        />
      </div>

      {events.data?.fallback ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs leading-relaxed text-amber-900">
          The dedicated managed-events endpoint is not available, so this list is using{' '}
          <code className="rounded bg-white/70 px-1 py-0.5 font-mono text-[0.6875rem]">GET /events?scope=managed</code>.
          Status filtering and pagination for that fallback are applied in the browser, and only published events are
          returned by the API.
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-400">
          {meta ? pluralize(meta.total, 'event') : 'Loading events…'}
          {status !== 'all' ? <span className="text-ink-500"> · {status}</span> : null}
        </p>
        {events.isFetching && events.data ? (
          <span className="inline-flex items-center gap-1.5 text-[0.6875rem] font-semibold text-ink-400">
            <Clock3 className="h-3 w-3 animate-pulse" /> Refreshing
          </span>
        ) : null}
      </div>

      {events.isError ? (
        <ErrorState
          title="We could not load your events"
          message={errorMessage(events.error)}
          onRetry={() => events.refetch()}
        />
      ) : showSkeleton ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-32 rounded-3xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarPlus className="h-6 w-6" />}
            title={deferredSearch ? 'No events match your search' : status === 'all' ? 'No events yet' : `No ${status} events`}
            description={
              deferredSearch
                ? 'Try a different title, club or venue.'
                : 'Create your first event and submit it for admin approval.'
            }
            action={
              deferredSearch ? (
                <Button variant="secondary" size="sm" onClick={() => changeSearch('')}>
                  Clear search
                </Button>
              ) : (
                <Link to="/coordinator/events/new" className={buttonStyles({ size: 'sm' })}>
                  <CalendarPlus className="h-3.5 w-3.5" /> Create event
                </Link>
              )
            }
          />
        </Card>
      ) : (
        <div className={cn('space-y-3 transition-opacity', events.isFetching && 'opacity-70')}>
          {rows.map((event) => (
            <article
              key={event.eventId}
              className="rounded-3xl border border-ink-200/70 bg-white p-4 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift sm:p-5"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-4">
                  <span className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-ink-950 text-white">
                    <span className="text-[0.5625rem] font-bold uppercase tracking-[0.12em] text-acid-300">
                      {formatDate(event.eventDate, 'MMM')}
                    </span>
                    <span className="text-lg font-bold leading-tight">{formatDate(event.eventDate, 'd')}</span>
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-base font-bold tracking-[-0.02em] text-ink-950">{event.title}</h2>
                      <StatusBadge status={event.status} />
                    </div>
                    <p className="text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-brand-700">
                      {event.clubName}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock3 className="h-3.5 w-3.5 text-ink-400" />
                        {formatDate(event.eventDate, 'EEE, d MMM yyyy')} · {formatTime(event.eventDate)}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-ink-400" /> {event.venueName}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5 text-ink-400" /> {event.totalRegistrations} registered
                      </span>
                    </div>
                    {event.status === 'pending' ? (
                      <p className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[0.6875rem] font-semibold text-amber-700">
                        <Info className="h-3 w-3" /> Awaiting administrator approval — not visible to students yet.
                      </p>
                    ) : null}
                    {event.status === 'rejected' && event.rejectionReason ? (
                      <p className="text-[0.6875rem] leading-relaxed text-rose-600">
                        Rejected: {event.rejectionReason}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="w-full shrink-0 space-y-1.5 lg:w-56">
                  <CapacityBar confirmed={event.confirmedRegistrations} capacity={event.capacity} />
                  <p className="text-[0.6875rem] text-ink-400">
                    Deadline {formatDate(event.registrationDeadline, 'd MMM')} · {event.feedbackCount} feedback
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
                  <Link
                    to={`/coordinator/events/${event.eventId}/attendance`}
                    className={buttonStyles({ size: 'sm', variant: 'secondary' })}
                  >
                    <ClipboardCheck className="h-3.5 w-3.5" /> Attendance
                  </Link>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => navigate(`/coordinator/events/${event.eventId}/edit`)}
                    leftIcon={<Pencil className="h-3.5 w-3.5" />}
                  >
                    Edit
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9 text-ink-400 hover:text-rose-600"
                    onClick={() => setEventToDelete(event)}
                    aria-label={`Delete ${event.title}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {meta ? (
        <Pagination meta={meta} onPageChange={setPage} label="events" className="pt-2" />
      ) : null}

      <ConfirmDialog
        open={Boolean(eventToDelete)}
        onClose={() => (remove.isPending ? undefined : setEventToDelete(null))}
        onConfirm={() => {
          if (eventToDelete) remove.mutate(eventToDelete)
        }}
        title="Delete this event?"
        description={
          eventToDelete
            ? `"${eventToDelete.title}" will be removed permanently. Events with existing registrations cannot be deleted.`
            : undefined
        }
        confirmLabel="Delete event"
        tone="danger"
        loading={remove.isPending}
      />
    </div>
  )
}
