import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { toast } from 'sonner'
import { CalendarDays, MapPin } from 'lucide-react'
import { api, ApiError, errorMessage } from '@/services/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDate, formatTime } from '@/lib/utils'
import type { CampusEvent, EventStatus } from '@/types'
import { PageHeader, ErrorState, SearchInput } from '@/components/shared/PageChrome'
import { CapacityBar } from '@/components/shared/CapacityBar'
import { Pagination } from '@/components/shared/Pagination'
import { Card, CardFooter } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { Select, Textarea } from '@/components/ui/Input'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Skeleton'
import { TableWrapper, Table, THead, TBody, TR, TH, TD, TableEmpty } from '@/components/ui/Table'

const PAGE_SIZE = 10

const rejectSchema = z.object({
  rejectionReason: z
    .string()
    .trim()
    .min(3, 'Give a short reason for the rejection.')
    .max(500, 'Keep the reason under 500 characters.'),
})

type RejectValues = z.infer<typeof rejectSchema>

function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export default function AdminEventsPage() {
  usePageTitle('Events')
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const debouncedSearch = useDebouncedValue(search)

  const [rejecting, setRejecting] = useState<CampusEvent | null>(null)
  const [confirming, setConfirming] = useState<{ event: CampusEvent; nextStatus: 'completed' | 'cancelled' } | null>(null)

  const events = useQuery({
    queryKey: ['admin-events', { search: debouncedSearch, status, page }],
    queryFn: () =>
      api.list<CampusEvent>('/admin/events', {
        search: debouncedSearch.trim() || undefined,
        status: status || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  })

  const rejectForm = useForm<RejectValues>({
    resolver: zodResolver(rejectSchema),
    defaultValues: { rejectionReason: '' },
  })

  useEffect(() => {
    if (rejecting) {
      rejectForm.reset({ rejectionReason: '' })
    }
  }, [rejecting, rejectForm])

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-events'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] })
  }

  const updateStatus = useMutation({
    mutationFn: ({
      id,
      nextStatus,
      rejectionReason,
    }: {
      id: number
      nextStatus: EventStatus
      rejectionReason?: string
    }) =>
      api.patch<CampusEvent>(`/admin/events/${id}/status`, {
        status: nextStatus,
        ...(rejectionReason ? { rejectionReason } : {}),
      }),
    onSuccess: (_, variables) => {
      const copy: Record<string, string> = {
        published: 'Event approved',
        rejected: 'Event rejected',
        completed: 'Event marked as completed',
        cancelled: 'Event cancelled',
        pending: 'Event reopened for review',
      }
      toast.success(copy[variables.nextStatus] ?? 'Event status updated')
      setRejecting(null)
      setConfirming(null)
      invalidate()
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const [field, message] of Object.entries(error.fields)) {
          if (field === 'rejectionReason') {
            rejectForm.setError(field, { type: 'server', message })
          }
        }
      }
      toast.error(errorMessage(error))
    },
  })

  const submitRejection = (values: RejectValues) => {
    if (!rejecting) return
    updateStatus.mutate({ id: rejecting.eventId, nextStatus: 'rejected', rejectionReason: values.rejectionReason })
  }

  const total = events.data?.meta.total

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Admin console"
        title="Events"
        description="Review submissions from clubs, publish what is ready and close out events that have finished."
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          placeholder="Search events by title or club…"
          className="sm:max-w-md"
        />
        <div className="flex items-center gap-3">
          <Select
            aria-label="Filter by event status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value)
              setPage(1)
            }}
            className="h-10 min-w-40"
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="published">Published</option>
            <option value="rejected">Rejected</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="draft">Draft</option>
          </Select>
          {typeof total === 'number' ? (
            <span className="hidden whitespace-nowrap text-xs font-semibold text-ink-400 sm:block">
              {total} {total === 1 ? 'event' : 'events'}
            </span>
          ) : null}
        </div>
      </div>

      {events.isError ? (
        <ErrorState title="Events could not be loaded" message={errorMessage(events.error)} onRetry={() => void events.refetch()} />
      ) : (
        <Card>
          <TableWrapper>
            <Table>
              <THead>
                <TR>
                  <TH className="pl-6">Event</TH>
                  <TH>Venue</TH>
                  <TH>Date</TH>
                  <TH>Registrations</TH>
                  <TH>Status</TH>
                  <TH className="pr-6 text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {events.isLoading ? (
                  <TableEmpty colSpan={6}>
                    <span className="inline-flex items-center gap-2">
                      <Spinner className="h-4 w-4" /> Loading events…
                    </span>
                  </TableEmpty>
                ) : events.data && events.data.data.length > 0 ? (
                  events.data.data.map((event) => (
                    <TR key={event.eventId}>
                      <TD className="min-w-56 pl-6">
                        <p className="max-w-64 truncate text-sm font-semibold text-ink-900" title={event.title}>
                          {event.title}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-ink-400">{event.clubName}</p>
                      </TD>
                      <TD className="whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 text-xs text-ink-600">
                          <MapPin className="h-3.5 w-3.5 text-ink-400" /> {event.venueName}
                        </span>
                      </TD>
                      <TD className="whitespace-nowrap">
                        <p className="text-xs font-semibold text-ink-700">{formatDate(event.eventDate)}</p>
                        <p className="mt-0.5 text-[0.6875rem] text-ink-400">{formatTime(event.eventDate)}</p>
                      </TD>
                      <TD>
                        <div className="w-36">
                          <CapacityBar confirmed={event.confirmedRegistrations} capacity={event.capacity} />
                          {event.totalRegistrations > event.confirmedRegistrations ? (
                            <p className="mt-1 text-[0.625rem] text-ink-400">
                              {event.totalRegistrations} total registrations
                            </p>
                          ) : null}
                        </div>
                      </TD>
                      <TD>
                        <StatusBadge status={event.status} />
                        {event.status === 'rejected' && event.rejectionReason ? (
                          <p
                            className="mt-1.5 max-w-44 truncate text-[0.6875rem] leading-relaxed text-rose-600"
                            title={event.rejectionReason}
                          >
                            {event.rejectionReason}
                          </p>
                        ) : null}
                      </TD>
                      <TD className="pr-6">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {event.status === 'pending' ? (
                            <>
                              <Button
                                size="sm"
                                onClick={() => updateStatus.mutate({ id: event.eventId, nextStatus: 'published' })}
                                disabled={updateStatus.isPending}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setRejecting(event)}
                                disabled={updateStatus.isPending}
                              >
                                Reject
                              </Button>
                            </>
                          ) : event.status === 'published' ? (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setConfirming({ event, nextStatus: 'completed' })}
                                disabled={updateStatus.isPending}
                              >
                                Complete
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                                onClick={() => setConfirming({ event, nextStatus: 'cancelled' })}
                                disabled={updateStatus.isPending}
                              >
                                Cancel
                              </Button>
                            </>
                          ) : event.status === 'rejected' ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => updateStatus.mutate({ id: event.eventId, nextStatus: 'pending' })}
                              disabled={updateStatus.isPending}
                            >
                              Reopen
                            </Button>
                          ) : null}
                        </div>
                      </TD>
                    </TR>
                  ))
                ) : (
                  <TableEmpty colSpan={6}>
                    <div className="flex flex-col items-center justify-center py-6">
                      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100 text-ink-400">
                        <CalendarDays className="h-5 w-5" />
                      </span>
                      <p className="text-sm font-semibold text-ink-800">
                        {search || status ? 'No events match these filters' : 'No events yet'}
                      </p>
                      <p className="mt-1 text-xs text-ink-400">
                        {search || status
                          ? 'Try a different search term or status.'
                          : 'Events submitted by clubs will appear here for review.'}
                      </p>
                    </div>
                  </TableEmpty>
                )}
              </TBody>
            </Table>
          </TableWrapper>
          <CardFooter className="justify-between">
            <Pagination meta={events.data?.meta} onPageChange={setPage} label="events" />
          </CardFooter>
        </Card>
      )}

      <Modal
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        title="Reject event"
        description={rejecting ? `Tell the coordinator why ${rejecting.title} cannot be published yet.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(null)} disabled={updateStatus.isPending}>
              Cancel
            </Button>
            <Button type="submit" form="reject-event-form" variant="danger" loading={updateStatus.isPending}>
              Reject event
            </Button>
          </>
        }
      >
        <form id="reject-event-form" onSubmit={rejectForm.handleSubmit(submitRejection)} className="space-y-4" noValidate>
          {rejecting ? (
            <div className="rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3">
              <p className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-ink-400">Event</p>
              <p className="mt-1 text-sm font-semibold text-ink-900">{rejecting.title}</p>
              <p className="text-xs text-ink-500">
                {rejecting.clubName} · {formatDate(rejecting.eventDate)}
              </p>
            </div>
          ) : null}
          <Textarea
            label="Rejection reason"
            required
            rows={4}
            placeholder="What needs to change before this event can be published?"
            hint="This reason is shown to the club coordinator."
            error={rejectForm.formState.errors.rejectionReason?.message}
            {...rejectForm.register('rejectionReason')}
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming) updateStatus.mutate({ id: confirming.event.eventId, nextStatus: confirming.nextStatus })
        }}
        title={confirming?.nextStatus === 'completed' ? 'Complete this event?' : 'Cancel this event?'}
        description={
          confirming
            ? confirming.nextStatus === 'completed'
              ? `${confirming.event.title} will be moved to completed. Registrations and attendance history stay intact.`
              : `${confirming.event.title} will be cancelled and closed to new registrations. This is visible to students.`
            : undefined
        }
        confirmLabel={confirming?.nextStatus === 'completed' ? 'Mark completed' : 'Cancel event'}
        tone={confirming?.nextStatus === 'cancelled' ? 'danger' : 'primary'}
        loading={updateStatus.isPending}
      />
    </div>
  )
}
