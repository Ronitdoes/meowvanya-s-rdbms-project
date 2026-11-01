import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Award,
  CalendarDays,
  Check,
  ClipboardCheck,
  Info,
  MapPin,
  Save,
  Users,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError, errorMessage } from '@/services/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import { cn, formatDate, formatTime, pluralize } from '@/lib/utils'
import type {
  Attendance,
  AttendanceStatus,
  CampusEvent,
  Certificate,
  EventStats,
  Registration,
} from '@/types'
import { EmptyState, ErrorState, PageHeader } from '@/components/shared/PageChrome'
import { Avatar } from '@/components/shared/Avatar'
import { CapacityBar } from '@/components/shared/CapacityBar'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { ConfirmDialog } from '@/components/ui/Modal'
import { ListSkeleton, PageSkeleton } from '@/components/ui/Skeleton'
import {
  Table,
  TableEmpty,
  TableWrapper,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui/Table'

/** Undefined means the attendee has not been marked yet. */
type Marks = Record<number, AttendanceStatus | undefined>

const NO_REGISTRATIONS: Registration[] = []

interface SaveAttendanceVariables {
  entries: Array<{ registrationId: number; status: AttendanceStatus }>
  snapshot: Marks
}

interface CertificateResult {
  issued: number
  certificates: Certificate[]
}

/**
 * Coordinator event lookups have their own endpoint in the contract, but the
 * deployed API may only expose the public `/events/{id}` route. Try the
 * coordinator route first, then fall back.
 */
async function fetchEventForAttendance(id: string): Promise<CampusEvent> {
  try {
    return await api.get<CampusEvent>(`/coordinator/events/${id}`)
  } catch (error) {
    if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 405)) {
      throw error
    }
  }
  return api.get<CampusEvent>(`/events/${id}`)
}

export default function CoordinatorAttendancePage() {
  const { id } = useParams<{ id: string }>()
  const eventId = id ?? ''
  usePageTitle('Attendance')

  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [marks, setMarks] = useState<Marks>({})
  const [savedMarks, setSavedMarks] = useState<Marks>({})
  const [issuedCodes, setIssuedCodes] = useState<Record<number, string>>({})
  const [sessionCertificates, setSessionCertificates] = useState<Certificate[]>([])
  const [leaveOpen, setLeaveOpen] = useState(false)
  const initializedEventId = useRef<string | null>(null)

  const eventQuery = useQuery({
    queryKey: ['managed-event', eventId],
    queryFn: () => fetchEventForAttendance(eventId),
    enabled: Boolean(eventId),
  })

  const registrationsQuery = useQuery({
    queryKey: ['event-registrations', eventId],
    queryFn: () =>
      api.list<Registration>(`/events/${eventId}/registrations`, {
        status: 'confirmed',
        page: 1,
        pageSize: 100,
      }),
    enabled: Boolean(eventId),
  })

  const statsQuery = useQuery({
    queryKey: ['event-stats', eventId],
    queryFn: () => api.get<EventStats>(`/events/${eventId}/stats`),
    enabled: Boolean(eventId),
  })

  const rows = registrationsQuery.data?.data ?? NO_REGISTRATIONS

  // Seed the local register once from the saved attendance statuses. Later
  // refetches must not discard marks the coordinator has not saved yet.
  useEffect(() => {
    if (!registrationsQuery.data || initializedEventId.current === eventId) return
    const next: Marks = {}
    for (const registration of registrationsQuery.data.data) {
      next[registration.registrationId] = registration.attendanceStatus ?? undefined
    }
    initializedEventId.current = eventId
    setMarks(next)
    setSavedMarks(next)
    setIssuedCodes({})
    setSessionCertificates([])
  }, [registrationsQuery.data, eventId])

  const isDirty = useMemo(
    () =>
      rows.some(
        (registration) =>
          (marks[registration.registrationId] ?? null) !==
          (savedMarks[registration.registrationId] ?? null),
      ),
    [rows, marks, savedMarks],
  )

  useEffect(() => {
    if (!isDirty) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  const invalidateAfterAttendance = () => {
    void queryClient.invalidateQueries({ queryKey: ['event-stats', eventId] })
    void queryClient.invalidateQueries({ queryKey: ['event-registrations', eventId] })
    void queryClient.invalidateQueries({ queryKey: ['coordinator-dashboard'] })
    void queryClient.invalidateQueries({ queryKey: ['managed-events'] })
  }

  const save = useMutation({
    mutationFn: ({ entries }: SaveAttendanceVariables) =>
      api.post<Attendance[]>(`/events/${eventId}/attendance`, { entries }),
    onSuccess: (_attendance, variables) => {
      setSavedMarks(variables.snapshot)
      toast.success(`Attendance saved for ${pluralize(variables.entries.length, 'attendee')}`)
      invalidateAfterAttendance()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const issueCertificates = useMutation({
    mutationFn: () => api.post<CertificateResult>(`/events/${eventId}/certificates`),
    onSuccess: (result) => {
      if (result.issued > 0) {
        toast.success(`Issued ${pluralize(result.issued, 'certificate')}`)
      } else {
        toast.info('No new certificates to issue. Save attendance for present students first.')
      }
      if (result.certificates.length > 0) {
        setSessionCertificates((previous) => {
          const merged = new Map(previous.map((certificate) => [certificate.certificateId, certificate]))
          for (const certificate of result.certificates) {
            merged.set(certificate.certificateId, certificate)
          }
          return Array.from(merged.values())
        })
        setIssuedCodes((previous) => {
          const next = { ...previous }
          for (const certificate of result.certificates) {
            next[certificate.registrationId] = certificate.certificateCode
          }
          return next
        })
      }
      invalidateAfterAttendance()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const event = eventQuery.data
  const stats = statsQuery.data

  const presentCount = rows.filter(
    (registration) => marks[registration.registrationId] === 'present',
  ).length
  const absentCount = rows.filter(
    (registration) => marks[registration.registrationId] === 'absent',
  ).length
  const unmarkedCount = Math.max(0, rows.length - presentCount - absentCount)
  const attendanceRate = rows.length > 0 ? Math.round((presentCount / rows.length) * 100) : 0

  const markAll = (status: AttendanceStatus) => {
    const next: Marks = {}
    for (const registration of rows) next[registration.registrationId] = status
    setMarks(next)
  }

  const toggle = (registrationId: number) => {
    setMarks((previous) => ({
      ...previous,
      [registrationId]: previous[registrationId] === 'present' ? 'absent' : 'present',
    }))
  }

  const handleSave = () => {
    const entries: Array<{ registrationId: number; status: AttendanceStatus }> = []
    for (const registration of rows) {
      const status = marks[registration.registrationId]
      if (status) entries.push({ registrationId: registration.registrationId, status })
    }
    if (entries.length === 0) return
    save.mutate({ entries, snapshot: { ...marks } })
  }

  const handleBack = () => {
    if (isDirty) {
      setLeaveOpen(true)
      return
    }
    navigate('/coordinator/events')
  }

  if (eventQuery.isLoading && registrationsQuery.isLoading) {
    return (
      <div className="space-y-7">
        <PageHeader eyebrow="Coordinator studio" title="Attendance" />
        <PageSkeleton />
      </div>
    )
  }

  if (eventQuery.isError) {
    return (
      <div className="space-y-7">
        <PageHeader eyebrow="Coordinator studio" title="Attendance" backTo="/coordinator/events" />
        <ErrorState
          title="We could not load this event"
          message={errorMessage(eventQuery.error)}
          onRetry={() => eventQuery.refetch()}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={event ? `${event.clubName} · ${formatDate(event.eventDate, 'EEE, d MMM yyyy')}` : 'Coordinator studio'}
        title="Attendance"
        description="Mark who showed up, save the register and issue certificates for present attendees."
        actions={
          <>
            <Button variant="secondary" onClick={handleBack} leftIcon={<X className="h-4 w-4" />}>
              Back to events
            </Button>
            <Button
              variant="secondary"
              onClick={() => issueCertificates.mutate()}
              loading={issueCertificates.isPending}
              disabled={presentCount === 0 || save.isPending}
              leftIcon={<Award className="h-4 w-4" />}
            >
              Issue certificates
            </Button>
            <Button
              onClick={handleSave}
              loading={save.isPending}
              disabled={!isDirty || rows.length === 0}
              leftIcon={<Save className="h-4 w-4" />}
            >
              Save attendance
            </Button>
          </>
        }
      />

      {event ? (
        <Card>
          <CardContent className="grid gap-5 lg:grid-cols-[1.4fr_1fr] lg:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-bold tracking-[-0.02em] text-ink-950">{event.title}</h2>
                <StatusBadge status={event.status} />
                {event.status === 'pending' ? <Badge tone="warning">Awaiting approval</Badge> : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-500">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5 text-ink-400" />
                  {formatDate(event.eventDate, 'EEE, d MMM yyyy')} · {formatTime(event.eventDate)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-ink-400" /> {event.venueName}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-ink-400" /> {event.clubName}
                </span>
                {stats ? (
                  <span className="inline-flex items-center gap-1.5">
                    <ClipboardCheck className="h-3.5 w-3.5 text-ink-400" />
                    {stats.presentCount} present · {stats.absentCount} absent saved
                  </span>
                ) : null}
              </div>
            </div>
            <div className="space-y-2">
              <CapacityBar confirmed={rows.length} capacity={event.capacity} />
              <p className="text-[0.6875rem] text-ink-400">
                {rows.length} confirmed registrations · capacity {event.capacity}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-ink-200/70 bg-white p-4 shadow-card">
          <p className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-ink-400">Confirmed</p>
          <p className="mt-1.5 text-2xl font-bold tracking-[-0.04em] text-ink-950">{rows.length}</p>
          <p className="mt-0.5 text-xs text-ink-500">
            {unmarkedCount > 0 ? `${unmarkedCount} not marked yet` : 'registrations to mark'}
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/60 p-4 shadow-card">
          <p className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-emerald-700">Present</p>
          <p className="mt-1.5 text-2xl font-bold tracking-[-0.04em] text-emerald-800">{presentCount}</p>
          <p className="mt-0.5 text-xs text-emerald-700/70">selected as present</p>
        </div>
        <div className="rounded-2xl border border-rose-200/70 bg-rose-50/60 p-4 shadow-card">
          <p className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-rose-700">Absent</p>
          <p className="mt-1.5 text-2xl font-bold tracking-[-0.04em] text-rose-800">{absentCount}</p>
          <p className="mt-0.5 text-xs text-rose-700/70">selected as absent</p>
        </div>
        <div className="rounded-2xl border border-ink-200/70 bg-ink-950 p-4 text-white shadow-card">
          <p className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-white/50">Attendance rate</p>
          <p className="mt-1.5 text-2xl font-bold tracking-[-0.04em] text-acid-300">{attendanceRate}%</p>
          <p className="mt-0.5 text-xs text-white/45">present / confirmed</p>
        </div>
      </div>

      {statsQuery.isError ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-xs text-amber-900">
          Live stats are unavailable right now. Counts above are calculated from the current roster.
        </p>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader
          title="Confirmed registrations"
          description="Everyone who holds a confirmed seat. Changes are saved together when you press Save attendance."
          action={
            <div className="flex flex-wrap items-center gap-2">
              {isDirty ? (
                <Badge tone="warning" dot>
                  Unsaved changes
                </Badge>
              ) : (
                <Badge tone="neutral" dot>
                  Saved
                </Badge>
              )}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => markAll('present')}
                disabled={rows.length === 0}
                leftIcon={<Check className="h-3.5 w-3.5" />}
              >
                All present
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => markAll('absent')}
                disabled={rows.length === 0}
                leftIcon={<X className="h-3.5 w-3.5" />}
              >
                All absent
              </Button>
            </div>
          }
        />

        {registrationsQuery.isError ? (
          <div className="p-6">
            <ErrorState
              title="We could not load the registrations"
              message={errorMessage(registrationsQuery.error)}
              onRetry={() => registrationsQuery.refetch()}
            />
          </div>
        ) : registrationsQuery.isLoading && !registrationsQuery.data ? (
          <div className="p-6">
            <ListSkeleton rows={5} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheck className="h-6 w-6" />}
            title="No confirmed registrations yet"
            description="Attendance can be marked once students have confirmed registrations for this event."
          />
        ) : (
          <TableWrapper>
            <Table>
              <THead>
                <TR>
                  <TH>Student</TH>
                  <TH>Enrollment</TH>
                  <TH>Department</TH>
                  <TH>Attendance</TH>
                  <TH>Certificate</TH>
                  <TH className="text-right">Toggle</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((registration) => {
                  const current = marks[registration.registrationId]
                  const certificateCode =
                    issuedCodes[registration.registrationId] ?? registration.certificateCode ?? null
                  return (
                    <TR key={registration.registrationId}>
                      <TD>
                        <div className="flex min-w-[170px] items-center gap-3">
                          <Avatar name={registration.studentName} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-ink-900">
                              {registration.studentName}
                            </p>
                            <p className="truncate text-xs text-ink-400">{registration.email}</p>
                          </div>
                        </div>
                      </TD>
                      <TD className="whitespace-nowrap font-mono text-xs text-ink-600">
                        {registration.enrollmentNumber}
                      </TD>
                      <TD className="whitespace-nowrap text-xs">{registration.departmentName}</TD>
                      <TD>
                        <div className="flex flex-col items-start gap-1">
                          <div className="inline-flex rounded-full border border-ink-200 bg-white p-0.5">
                            <button
                              type="button"
                              aria-pressed={current === 'present'}
                              onClick={() =>
                                setMarks((previous) => ({
                                  ...previous,
                                  [registration.registrationId]: 'present',
                                }))
                              }
                              className={cn(
                                'rounded-full px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.04em] transition-colors',
                                current === 'present'
                                  ? 'bg-emerald-600 text-white'
                                  : 'text-ink-500 hover:bg-ink-50',
                              )}
                            >
                              Present
                            </button>
                            <button
                              type="button"
                              aria-pressed={current === 'absent'}
                              onClick={() =>
                                setMarks((previous) => ({
                                  ...previous,
                                  [registration.registrationId]: 'absent',
                                }))
                              }
                              className={cn(
                                'rounded-full px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.04em] transition-colors',
                                current === 'absent'
                                  ? 'bg-rose-600 text-white'
                                  : 'text-ink-500 hover:bg-ink-50',
                              )}
                            >
                              Absent
                            </button>
                          </div>
                          {current === undefined ? (
                            <span className="text-[0.625rem] font-medium text-ink-400">Not marked</span>
                          ) : null}
                        </div>
                      </TD>
                      <TD>
                        {certificateCode ? (
                          <span className="font-mono text-[0.6875rem] font-semibold text-brand-700">
                            {certificateCode}
                          </span>
                        ) : (
                          <span className="text-xs text-ink-400">—</span>
                        )}
                      </TD>
                      <TD className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggle(registration.registrationId)}
                          aria-label={`Toggle attendance for ${registration.studentName}`}
                        >
                          {current === 'present' ? 'Mark absent' : 'Mark present'}
                        </Button>
                      </TD>
                    </TR>
                  )
                })}
                {rows.length === 0 ? <TableEmpty colSpan={6}>No confirmed registrations.</TableEmpty> : null}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </Card>

      {isDirty ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-[0.8125rem] text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <p className="inline-flex items-center gap-2">
            <Info className="h-4 w-4 shrink-0" />
            You have unsaved attendance changes. Save before leaving this page.
          </p>
          <Button
            size="sm"
            onClick={handleSave}
            loading={save.isPending}
            leftIcon={<Save className="h-3.5 w-3.5" />}
          >
            Save attendance
          </Button>
        </div>
      ) : null}

      {sessionCertificates.length > 0 ? (
        <Card>
          <CardHeader
            title="Certificates issued in this session"
            description="Certificate codes are generated for present attendees and can be shared with students."
            action={<Badge tone="success">{sessionCertificates.length} issued</Badge>}
          />
          <CardContent className="grid gap-2 pt-4 sm:grid-cols-2">
            {sessionCertificates.map((certificate) => (
              <div
                key={certificate.certificateId}
                className="flex items-center justify-between gap-3 rounded-2xl border border-ink-100 px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-ink-900">{certificate.studentName}</p>
                  <p className="truncate text-[0.625rem] text-ink-400">{certificate.eventTitle}</p>
                </div>
                <span className="shrink-0 font-mono text-[0.6875rem] font-semibold text-brand-700">
                  {certificate.certificateCode}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <ConfirmDialog
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        onConfirm={() => {
          setLeaveOpen(false)
          navigate('/coordinator/events')
        }}
        title="Discard unsaved attendance?"
        description="You have attendance changes that have not been saved. Leaving now will lose them."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        tone="danger"
      />
    </div>
  )
}
