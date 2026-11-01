import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, Award, CalendarDays, CalendarPlus, CalendarX2, MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { api, errorMessage } from '@/services/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import { cn, formatDate, formatTime, pluralize } from '@/lib/utils'
import type { Registration } from '@/types'
import { EmptyState, ErrorState, PageHeader } from '@/components/shared/PageChrome'
import { Pagination } from '@/components/shared/Pagination'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import { Button, buttonStyles } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/Modal'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { Table, TableWrapper, TBody, TD, TH, THead, TR } from '@/components/ui/Table'

const PAGE_SIZE = 10

type StatusTab = 'all' | 'confirmed' | 'cancelled'

const statusTabs: Array<{ value: StatusTab; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'cancelled', label: 'Cancelled' },
]

function emptyCopy(status: StatusTab) {
  if (status === 'confirmed') {
    return {
      title: 'No confirmed registrations',
      description: 'Register for an event and your seat will appear here with attendance and certificate details.',
    }
  }
  if (status === 'cancelled') {
    return {
      title: 'Nothing cancelled',
      description: 'Registrations you release will stay listed here for your records.',
    }
  }
  return {
    title: 'No registrations yet',
    description: 'Browse upcoming events from your clubs and reserve your first seat.',
  }
}

export default function StudentRegistrationsPage() {
  usePageTitle('My registrations')
  const queryClient = useQueryClient()

  const [status, setStatus] = useState<StatusTab>('all')
  const [page, setPage] = useState(1)
  const [cancelTarget, setCancelTarget] = useState<Registration | null>(null)

  const registrations = useQuery({
    queryKey: ['my-registrations', { status, page }],
    queryFn: () =>
      api.list<Registration>('/me/registrations', {
        status: status === 'all' ? undefined : status,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  })

  const cancel = useMutation({
    mutationFn: (registration: Registration) => api.delete(`/registrations/${registration.registrationId}`),
    onSuccess: (_result, registration) => {
      toast.success('Registration cancelled', {
        description: `Your seat for ${registration.eventTitle} has been released.`,
      })
      setCancelTarget(null)
      void queryClient.invalidateQueries({ queryKey: ['my-registrations'] })
      void queryClient.invalidateQueries({ queryKey: ['events'] })
      void queryClient.invalidateQueries({ queryKey: ['student-dashboard'] })
    },
    onError: (error) => {
      toast.error(errorMessage(error))
      setCancelTarget(null)
    },
  })

  const changeStatus = (next: StatusTab) => {
    setStatus(next)
    setPage(1)
  }

  const rows = registrations.data?.data ?? []
  const meta = registrations.data?.meta
  const copy = emptyCopy(status)

  const isCancelling = (registrationId: number) =>
    cancel.isPending && cancel.variables?.registrationId === registrationId

  const cancelButton = (registration: Registration) => {
    if (registration.status !== 'confirmed') return null
    if (registration.attendanceStatus === 'present') return null
    return (
      <Button
        size="sm"
        variant="ghost"
        className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
        loading={isCancelling(registration.registrationId)}
        leftIcon={<CalendarX2 className="h-3.5 w-3.5" />}
        onClick={() => setCancelTarget(registration)}
      >
        Cancel
      </Button>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Student portal"
        title="My registrations"
        description="Every event you have signed up for, with attendance and certificate details in one place."
        actions={
          <Link to="/student/events" className={buttonStyles({ variant: 'secondary' })}>
            Browse events
          </Link>
        }
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 no-scrollbar"
          role="tablist"
          aria-label="Filter registrations by status"
        >
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

        <p className="text-xs text-ink-400">
          {meta
            ? `${pluralize(meta.total, 'registration')} ${status === 'all' ? 'in total' : `· ${status}`}`
            : 'Your event history'}
        </p>
      </div>

      <Card className="overflow-hidden">
        {registrations.isError ? (
          <ErrorState
            title="We could not load your registrations"
            message={errorMessage(registrations.error)}
            onRetry={() => registrations.refetch()}
          />
        ) : registrations.isLoading && !registrations.data ? (
          <div className="p-6">
            <ListSkeleton rows={5} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<CalendarPlus className="h-6 w-6" />}
            title={copy.title}
            description={copy.description}
            action={
              <Link to="/student/events" className={buttonStyles({ size: 'sm' })}>
                Find an event
              </Link>
            }
          />
        ) : (
          <>
            <div className="hidden md:block">
              <TableWrapper>
                <Table>
                  <THead>
                    <TR>
                      <TH>Event</TH>
                      <TH>Date &amp; time</TH>
                      <TH>Venue</TH>
                      <TH>Status</TH>
                      <TH>Attendance</TH>
                      <TH>Certificate</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {rows.map((registration) => (
                      <TR key={registration.registrationId}>
                        <TD>
                          <div className="min-w-[200px]">
                            <Link
                              to={`/student/events/${registration.eventId}`}
                              className="text-sm font-semibold text-ink-900 hover:text-brand-700 hover:underline"
                            >
                              {registration.eventTitle}
                            </Link>
                            <p className="mt-0.5 text-xs text-ink-400">{registration.clubName}</p>
                          </div>
                        </TD>
                        <TD className="whitespace-nowrap">
                          <p className="text-xs font-semibold text-ink-700">
                            {formatDate(registration.eventDate, 'EEE, d MMM yyyy')}
                          </p>
                          <p className="mt-0.5 text-xs text-ink-400">{formatTime(registration.eventDate)}</p>
                        </TD>
                        <TD className="whitespace-nowrap text-xs">{registration.venueName}</TD>
                        <TD>
                          <StatusBadge status={registration.status} />
                          {registration.cancelledAt ? (
                            <p className="mt-1 text-[0.625rem] text-ink-400">
                              Cancelled {formatDate(registration.cancelledAt)}
                            </p>
                          ) : null}
                        </TD>
                        <TD>
                          {registration.attendanceStatus ? (
                            <StatusBadge status={registration.attendanceStatus} />
                          ) : (
                            <span className="text-xs text-ink-400">Not recorded</span>
                          )}
                        </TD>
                        <TD className="whitespace-nowrap">
                          {registration.certificateCode ? (
                            <Link
                              to="/student/certificates"
                              className="inline-flex items-center gap-1.5 font-mono text-[0.6875rem] font-semibold tracking-[0.06em] text-brand-700 hover:underline"
                            >
                              <Award className="h-3.5 w-3.5" /> {registration.certificateCode}
                            </Link>
                          ) : (
                            <span className="text-xs text-ink-400">—</span>
                          )}
                        </TD>
                        <TD>
                          <div className="flex items-center justify-end gap-1">
                            {cancelButton(registration)}
                            <Link
                              to={`/student/events/${registration.eventId}`}
                              aria-label={`Open ${registration.eventTitle}`}
                              className={buttonStyles({
                                variant: 'ghost',
                                size: 'icon',
                                className: 'h-9 w-9 text-ink-400 hover:text-ink-800',
                              })}
                            >
                              <ArrowUpRight className="h-4 w-4" />
                            </Link>
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrapper>
            </div>

            <div className="space-y-3 p-4 md:hidden">
              {rows.map((registration) => (
                <div
                  key={registration.registrationId}
                  className="rounded-2xl border border-ink-100 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-brand-700">
                        {registration.clubName}
                      </p>
                      <Link
                        to={`/student/events/${registration.eventId}`}
                        className="mt-1 block text-sm font-semibold leading-snug text-ink-900"
                      >
                        {registration.eventTitle}
                      </Link>
                    </div>
                    <StatusBadge status={registration.status} />
                  </div>

                  <div className="mt-3 space-y-1.5 text-xs text-ink-500">
                    <p className="flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5 text-ink-400" />
                      {formatDate(registration.eventDate, 'EEE, d MMM yyyy')} · {formatTime(registration.eventDate)}
                    </p>
                    <p className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-ink-400" />
                      {registration.venueName}
                    </p>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-ink-100 pt-3">
                    {registration.attendanceStatus ? (
                      <StatusBadge status={registration.attendanceStatus} />
                    ) : (
                      <Badge tone="neutral">Attendance not recorded</Badge>
                    )}
                    {registration.certificateCode ? (
                      <Link
                        to="/student/certificates"
                        className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 font-mono text-[0.625rem] font-semibold tracking-[0.06em] text-brand-700 ring-1 ring-inset ring-brand-600/15"
                      >
                        <Award className="h-3 w-3" /> {registration.certificateCode}
                      </Link>
                    ) : null}
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <Link
                      to={`/student/events/${registration.eventId}`}
                      className="text-xs font-semibold text-brand-700 hover:underline"
                    >
                      View event
                    </Link>
                    {cancelButton(registration)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {rows.length > 0 ? <Pagination meta={meta} onPageChange={setPage} label="registrations" /> : null}

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onClose={() => (cancel.isPending ? undefined : setCancelTarget(null))}
        onConfirm={() => {
          if (cancelTarget) cancel.mutate(cancelTarget)
        }}
        title="Cancel this registration?"
        description={
          cancelTarget ? (
            <>
              Your seat for <span className="font-semibold text-ink-800">{cancelTarget.eventTitle}</span> will be
              released and offered to another student. This cannot be undone.
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
