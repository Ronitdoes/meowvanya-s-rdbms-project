import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  ClipboardList,
  Clock3,
  GraduationCap,
  MapPin,
  Star,
  Users,
  X,
} from 'lucide-react'
import { api, ApiError, errorMessage } from '@/services/api'
import { useAuth } from '@/context/AuthContext'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDate, formatDateTime, formatTime, pluralize } from '@/lib/utils'
import type { AdminDashboard, CampusEvent, Club, Registration } from '@/types'
import { EmptyState, ErrorState, PageHeader } from '@/components/shared/PageChrome'
import { StatCard } from '@/components/shared/StatCard'
import { Avatar } from '@/components/shared/Avatar'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import { Button, buttonStyles } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Input'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { PageSkeleton } from '@/components/ui/Skeleton'
import { TableWrapper, Table, THead, TBody, TR, TH, TD, TableEmpty } from '@/components/ui/Table'

const rejectSchema = z.object({
  rejectionReason: z
    .string()
    .trim()
    .min(3, 'Give a short reason for the rejection.')
    .max(500, 'Keep the reason under 500 characters.'),
})

type RejectValues = z.infer<typeof rejectSchema>

const FEEDBACK_COLORS = ['#e11d48', '#f7bd3d', '#a9d01e', '#3ac884', '#0b8b55']
const CHART_TOOLTIP = {
  borderRadius: 16,
  border: '1px solid #e8eeeb',
  boxShadow: '0 18px 40px -24px rgba(10, 18, 16, 0.35)',
  fontSize: 12,
}

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function AdminDashboardPage() {
  usePageTitle('Admin overview')
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [rejectingClub, setRejectingClub] = useState<Club | null>(null)
  const [rejectingEvent, setRejectingEvent] = useState<CampusEvent | null>(null)

  const dashboard = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: () => api.get<AdminDashboard>('/admin/dashboard'),
  })

  const rejectForm = useForm<RejectValues>({
    resolver: zodResolver(rejectSchema),
    defaultValues: { rejectionReason: '' },
  })

  useEffect(() => {
    if (rejectingEvent) {
      rejectForm.reset({ rejectionReason: '' })
    }
  }, [rejectingEvent, rejectForm])

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-clubs'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-events'] })
    void queryClient.invalidateQueries({ queryKey: ['clubs'] })
    void queryClient.invalidateQueries({ queryKey: ['events'] })
  }

  const setClubStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'approved' | 'rejected' }) =>
      api.patch<Club>(`/admin/clubs/${id}`, { status }),
    onSuccess: (_, variables) => {
      toast.success(variables.status === 'approved' ? 'Club approved' : 'Club rejected')
      setRejectingClub(null)
      invalidate()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const setEventStatus = useMutation({
    mutationFn: ({
      id,
      status,
      rejectionReason,
    }: {
      id: number
      status: 'published' | 'rejected'
      rejectionReason?: string
    }) =>
      api.patch<CampusEvent>(`/admin/events/${id}/status`, {
        status,
        ...(rejectionReason ? { rejectionReason } : {}),
      }),
    onSuccess: (_, variables) => {
      toast.success(variables.status === 'published' ? 'Event published' : 'Event rejected')
      setRejectingEvent(null)
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
    if (!rejectingEvent) return
    setEventStatus.mutate({
      id: rejectingEvent.eventId,
      status: 'rejected',
      rejectionReason: values.rejectionReason.trim(),
    })
  }

  const firstName = user?.student?.fullName?.split(' ')[0] ?? user?.email?.split('@')[0] ?? 'admin'
  const data = dashboard.data

  if (dashboard.isLoading) {
    return (
      <div className="space-y-7">
        <PageHeader eyebrow="Admin console" title="Admin overview" />
        <PageSkeleton />
      </div>
    )
  }

  if (dashboard.isError) {
    return (
      <div className="space-y-7">
        <PageHeader eyebrow="Admin console" title="Admin overview" />
        <ErrorState
          title="We could not load the admin overview"
          message={errorMessage(dashboard.error)}
          onRetry={() => void dashboard.refetch()}
        />
      </div>
    )
  }

  const stats = data?.stats
  const pendingClubs = data?.pendingClubs ?? []
  const pendingEvents = data?.pendingEvents ?? []
  const recentRegistrations = data?.recentRegistrations ?? []
  const registrationsByMonth = data?.registrationsByMonth ?? []
  const membersByClub = data?.membersByClub ?? []
  const feedbackDistribution = data?.feedbackDistribution ?? []

  const pendingTotal = pendingClubs.length + pendingEvents.length
  const registrationsTotal = registrationsByMonth.reduce((sum, point) => sum + point.value, 0)
  const feedbackSlices = feedbackDistribution.filter((point) => point.value > 0)
  const feedbackTotal = feedbackSlices.reduce((sum, point) => sum + point.value, 0)
  const topClubs = membersByClub.slice(0, 8)
  const membersTotal = topClubs.reduce((sum, point) => sum + point.value, 0)

  const heroStats = [
    { label: 'Pending reviews', value: pendingTotal, icon: <ClipboardList className="h-4 w-4" /> },
    { label: 'Total users', value: stats?.totalUsers ?? '—', icon: <Users className="h-4 w-4" /> },
    { label: 'Venues', value: stats?.totalVenues ?? '—', icon: <MapPin className="h-4 w-4" /> },
    { label: 'Departments', value: stats?.totalDepartments ?? '—', icon: <Building2 className="h-4 w-4" /> },
  ]

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={`Admin console · ${formatDate(new Date(), 'EEEE, d MMMM')}`}
        title={`${greeting()}, ${firstName}.`}
        description="Students, clubs, events and the queues that need your attention — all in one place."
        actions={
          <>
            <Link to="/admin/clubs" className={buttonStyles({ variant: 'secondary' })}>
              Manage clubs
            </Link>
            <Link to="/admin/events" className={buttonStyles({})}>
              Review events
            </Link>
          </>
        }
      />

      <section className="relative overflow-hidden rounded-[2rem] bg-ink-950 p-6 text-white shadow-card sm:p-8">
        <div className="surface-grid absolute inset-0 opacity-20" aria-hidden />
        <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-brand-500/25 blur-3xl" aria-hidden />
        <div className="absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-acid-300/10 blur-3xl" aria-hidden />
        <div className="relative grid gap-7 lg:grid-cols-[1.3fr_0.7fr] lg:items-center">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[0.625rem] font-bold uppercase tracking-[0.14em] text-acid-200">
              <span className="h-1.5 w-1.5 rounded-full bg-acid-300" /> Campus control room
            </p>
            <h2 className="display-title mt-4 max-w-xl text-3xl leading-[1.08] text-white sm:text-4xl">
              Keep the whole campus <span className="italic text-acid-200">moving</span>.
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-white/55">
              {pendingTotal > 0
                ? `${pluralize(pendingTotal, 'item')} ${pendingTotal === 1 ? 'is' : 'are'} waiting for a decision. Clear the queues to keep clubs and events flowing.`
                : 'Every club and event has been reviewed. The campus is up to date.'}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link to="/admin/events" className={buttonStyles({ variant: 'acid' })}>
                Open approval queues <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/admin/students"
                className="inline-flex h-10 items-center gap-2 rounded-full border border-white/15 px-4 text-[0.8125rem] font-semibold text-white/80 transition-colors hover:bg-white/10"
              >
                Student directory
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {heroStats.map((item) => (
              <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.055] p-4 backdrop-blur-sm">
                <span className="text-acid-200/80">{item.icon}</span>
                <p className="mt-3 text-2xl font-bold tracking-[-0.04em] text-white">{item.value}</p>
                <p className="mt-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-white/40">
                  {item.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Students"
          value={stats?.totalStudents ?? 0}
          hint={`${stats?.totalUsers ?? 0} total accounts`}
          icon={<GraduationCap className="h-4 w-4" />}
          to="/admin/students"
        />
        <StatCard
          label="Clubs"
          value={stats?.totalClubs ?? 0}
          hint={`${stats?.approvedClubs ?? 0} approved · ${stats?.pendingClubs ?? 0} pending`}
          icon={<Users className="h-4 w-4" />}
          tone="brand"
          to="/admin/clubs"
        />
        <StatCard
          label="Events"
          value={stats?.totalEvents ?? 0}
          hint={`${stats?.publishedEvents ?? 0} published · ${stats?.pendingEvents ?? 0} pending`}
          icon={<CalendarDays className="h-4 w-4" />}
          to="/admin/events"
        />
        <StatCard
          label="Registrations"
          value={stats?.confirmedRegistrations ?? 0}
          hint={`${stats?.certificatesIssued ?? 0} certificates issued`}
          icon={<ClipboardList className="h-4 w-4" />}
          tone="acid"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <Card className="min-w-0">
          <CardHeader
            title="Registrations by month"
            description="Confirmed sign-ups across the recent campus calendar."
            action={<Badge tone="brand">{registrationsTotal} total</Badge>}
          />
          <CardContent className="pt-5">
            {registrationsByMonth.length > 0 ? (
              <div className="h-64 w-full" aria-label="Registrations by month chart">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={registrationsByMonth} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                    <defs>
                      <linearGradient id="adminRegistrationsFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#17ad69" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#17ad69" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e8eeeb" vertical={false} />
                    <XAxis
                      dataKey="label"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#889a93', fontSize: 11 }}
                      tickMargin={10}
                    />
                    <YAxis
                      allowDecimals={false}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#889a93', fontSize: 11 }}
                      width={44}
                    />
                    <Tooltip
                      contentStyle={CHART_TOOLTIP}
                      labelStyle={{ color: '#141f1b', fontWeight: 700 }}
                      cursor={{ stroke: '#d4ded9', strokeDasharray: '4 4' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      name="Registrations"
                      stroke="#0a6f46"
                      strokeWidth={2.5}
                      fill="url(#adminRegistrationsFill)"
                      activeDot={{ r: 4, fill: '#dcf86a', stroke: '#0a6f46', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState
                className="py-12"
                icon={<CalendarDays className="h-5 w-5" />}
                title="No registration history yet"
                description="Monthly registration trends appear once students start signing up."
              />
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader
            title="Feedback mix"
            description="How attendees rated completed events."
            action={
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-500">
                <Star className="h-3.5 w-3.5 text-sun-400" />
                {stats?.averageFeedbackRating ? stats.averageFeedbackRating.toFixed(1) : '—'} avg
              </span>
            }
          />
          <CardContent className="pt-4">
            {feedbackTotal > 0 ? (
              <div className="space-y-4">
                <div className="relative h-44 w-full" aria-label="Feedback rating distribution chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={feedbackSlices}
                        dataKey="value"
                        nameKey="label"
                        innerRadius={52}
                        outerRadius={78}
                        paddingAngle={3}
                        strokeWidth={0}
                      >
                        {feedbackSlices.map((point, index) => (
                          <Cell
                            key={`${point.label}-${index}`}
                            fill={FEEDBACK_COLORS[index % FEEDBACK_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={CHART_TOOLTIP} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <p className="text-2xl font-bold tracking-[-0.04em] text-ink-950">{feedbackTotal}</p>
                    <p className="text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-ink-400">responses</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {feedbackSlices.map((point, index) => (
                    <div key={`${point.label}-${index}`} className="flex items-center justify-between gap-2 text-xs">
                      <span className="inline-flex min-w-0 items-center gap-2 text-ink-500">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: FEEDBACK_COLORS[index % FEEDBACK_COLORS.length] }}
                          aria-hidden
                        />
                        <span className="truncate">{point.label}</span>
                      </span>
                      <span className="font-semibold text-ink-800">{point.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState
                className="py-12"
                icon={<Star className="h-5 w-5" />}
                title="No feedback yet"
                description="Ratings appear here once attendees review completed events."
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0">
        <CardHeader
          title="Members by club"
          description="Approved membership across the busiest clubs."
          action={<Badge tone="neutral">{membersTotal} members</Badge>}
        />
        <CardContent className="pt-5">
          {topClubs.length > 0 && membersTotal > 0 ? (
            <div className="h-72 w-full" aria-label="Members by club chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topClubs} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8eeeb" horizontal={false} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#889a93', fontSize: 11 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={132}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#667972', fontSize: 11 }}
                  />
                  <Tooltip contentStyle={CHART_TOOLTIP} cursor={{ fill: '#f3f6f4' }} />
                  <Bar dataKey="value" name="Members" radius={[0, 8, 8, 0]} barSize={16}>
                    {topClubs.map((point, index) => (
                      <Cell
                        key={`${point.label}-${index}`}
                        fill={index === 0 ? '#dcf86a' : index % 2 === 0 ? '#17ad69' : '#0a6f46'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              className="py-12"
              icon={<Users className="h-5 w-5" />}
              title="No club membership data"
              description="Approved memberships will populate this chart as clubs grow."
            />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Clubs awaiting approval"
            description="New organisations that students cannot see yet."
            action={
              <Badge tone={pendingClubs.length > 0 ? 'warning' : 'neutral'}>
                {pendingClubs.length} pending
              </Badge>
            }
          />
          <CardContent className="space-y-3 pt-4">
            {pendingClubs.length > 0 ? (
              pendingClubs.map((club) => {
                const approving =
                  setClubStatus.isPending &&
                  setClubStatus.variables?.id === club.clubId &&
                  setClubStatus.variables.status === 'approved'
                return (
                  <div
                    key={club.clubId}
                    className="flex flex-col gap-3 rounded-2xl border border-ink-100 p-3.5 sm:flex-row sm:items-center"
                  >
                    <Avatar name={club.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink-900">{club.name}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-ink-500">
                        {club.description || 'No description provided.'}
                      </p>
                      <p className="mt-1 text-[0.6875rem] text-ink-400">
                        Created {formatDate(club.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setRejectingClub(club)}
                        disabled={setClubStatus.isPending}
                        leftIcon={<X className="h-3.5 w-3.5" />}
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => setClubStatus.mutate({ id: club.clubId, status: 'approved' })}
                        loading={approving}
                        disabled={setClubStatus.isPending && !approving}
                        leftIcon={<Check className="h-3.5 w-3.5" />}
                      >
                        Approve
                      </Button>
                    </div>
                  </div>
                )
              })
            ) : (
              <EmptyState
                className="py-10"
                icon={<Check className="h-5 w-5" />}
                title="No clubs waiting"
                description="Every submitted club has been reviewed."
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader
            title="Events awaiting approval"
            description="Submissions that need a publish or reject decision."
            action={
              <Badge tone={pendingEvents.length > 0 ? 'warning' : 'neutral'}>
                {pendingEvents.length} pending
              </Badge>
            }
          />
          <CardContent className="space-y-3 pt-4">
            {pendingEvents.length > 0 ? (
              pendingEvents.map((event) => {
                const publishing =
                  setEventStatus.isPending &&
                  setEventStatus.variables?.id === event.eventId &&
                  setEventStatus.variables.status === 'published'
                return (
                  <div
                    key={event.eventId}
                    className="flex flex-col gap-3 rounded-2xl border border-ink-100 p-3.5 sm:flex-row sm:items-center"
                  >
                    <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-ink-950 text-white">
                      <span className="text-[0.5rem] font-bold uppercase tracking-[0.1em] text-acid-300">
                        {formatDate(event.eventDate, 'MMM')}
                      </span>
                      <span className="text-base font-bold leading-none">{formatDate(event.eventDate, 'd')}</span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink-900">{event.title}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-500">
                        <span>{event.clubName}</span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3 text-ink-400" /> {event.venueName}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3 w-3 text-ink-400" /> {formatTime(event.eventDate)}
                        </span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setRejectingEvent(event)}
                        disabled={setEventStatus.isPending}
                        leftIcon={<X className="h-3.5 w-3.5" />}
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => setEventStatus.mutate({ id: event.eventId, status: 'published' })}
                        loading={publishing}
                        disabled={setEventStatus.isPending && !publishing}
                        leftIcon={<Check className="h-3.5 w-3.5" />}
                      >
                        Publish
                      </Button>
                    </div>
                  </div>
                )
              })
            ) : (
              <EmptyState
                className="py-10"
                icon={<Check className="h-5 w-5" />}
                title="No events waiting"
                description="Every event submission has been reviewed."
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Recent registrations"
          description="The latest students to sign up for campus events."
          action={
            <Link to="/admin/students" className="text-xs font-semibold text-brand-700 hover:underline">
              Student directory
            </Link>
          }
        />
        <TableWrapper className="mt-4">
          <Table>
            <THead>
              <TR>
                <TH className="pl-6">Student</TH>
                <TH>Event</TH>
                <TH>Club</TH>
                <TH>Registered</TH>
                <TH className="pr-6">Status</TH>
              </TR>
            </THead>
            <TBody>
              {recentRegistrations.length > 0 ? (
                recentRegistrations.map((registration: Registration) => (
                  <TR key={registration.registrationId}>
                    <TD className="pl-6">
                      <div className="flex min-w-48 items-center gap-3">
                        <Avatar name={registration.studentName} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink-900">{registration.studentName}</p>
                          <p className="truncate text-xs text-ink-400">
                            {registration.enrollmentNumber} · {registration.departmentName}
                          </p>
                        </div>
                      </div>
                    </TD>
                    <TD className="min-w-44">
                      <p className="max-w-56 truncate text-sm font-semibold text-ink-800" title={registration.eventTitle}>
                        {registration.eventTitle}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-400">{formatDate(registration.eventDate)}</p>
                    </TD>
                    <TD className="whitespace-nowrap text-sm">{registration.clubName}</TD>
                    <TD className="whitespace-nowrap text-xs text-ink-500">
                      {formatDateTime(registration.registeredAt)}
                    </TD>
                    <TD className="pr-6">
                      <StatusBadge status={registration.status} />
                    </TD>
                  </TR>
                ))
              ) : (
                <TableEmpty colSpan={5}>
                  <div className="flex justify-center">
                    <EmptyState
                      className="py-10"
                      icon={<ClipboardList className="h-6 w-6" />}
                      title="No registrations yet"
                      description="Student sign-ups will appear here as events open."
                    />
                  </div>
                </TableEmpty>
              )}
            </TBody>
          </Table>
        </TableWrapper>
      </Card>

      <Modal
        open={Boolean(rejectingEvent)}
        onClose={() => setRejectingEvent(null)}
        title="Reject event"
        description={rejectingEvent ? `Tell the coordinator why ${rejectingEvent.title} cannot be published yet.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejectingEvent(null)} disabled={setEventStatus.isPending}>
              Cancel
            </Button>
            <Button type="submit" form="admin-reject-event-form" variant="danger" loading={setEventStatus.isPending}>
              Reject event
            </Button>
          </>
        }
      >
        <form id="admin-reject-event-form" onSubmit={rejectForm.handleSubmit(submitRejection)} className="space-y-4" noValidate>
          {rejectingEvent ? (
            <div className="rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3">
              <p className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-ink-400">Event</p>
              <p className="mt-1 text-sm font-semibold text-ink-900">{rejectingEvent.title}</p>
              <p className="text-xs text-ink-500">
                {rejectingEvent.clubName} · {formatDate(rejectingEvent.eventDate)}
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
        open={Boolean(rejectingClub)}
        onClose={() => setRejectingClub(null)}
        onConfirm={() => {
          if (rejectingClub) setClubStatus.mutate({ id: rejectingClub.clubId, status: 'rejected' })
        }}
        title="Reject this club?"
        description={
          rejectingClub
            ? `${rejectingClub.name} will not be visible to students. You can approve it later from the club list.`
            : undefined
        }
        confirmLabel="Reject club"
        tone="danger"
        loading={setClubStatus.isPending}
      />
    </div>
  )
}
