import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  ArrowUpRight,
  Award,
  CalendarDays,
  CalendarPlus,
  Check,
  ClipboardList,
  Sparkles,
  Star,
  Users,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, errorMessage } from '@/services/api'
import { useAuth } from '@/context/AuthContext'
import { usePageTitle } from '@/hooks/usePageTitle'
import {
  eventDateLabel,
  formatDate,
  formatTime,
  relativeTime,
} from '@/lib/utils'
import type { ClubMember, CoordinatorDashboard, MembershipStatus } from '@/types'
import { EmptyState, ErrorState, PageHeader } from '@/components/shared/PageChrome'
import { StatCard } from '@/components/shared/StatCard'
import { Avatar, StarRating } from '@/components/shared/Avatar'
import { StatusBadge } from '@/components/ui/Badge'
import { Button, buttonStyles } from '@/components/ui/Button'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { PageSkeleton, Skeleton } from '@/components/ui/Skeleton'

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

interface DecisionVariables {
  clubId: number
  membershipId: number
  status: Exclude<MembershipStatus, 'pending'>
}

export default function CoordinatorDashboardPage() {
  usePageTitle('Coordinator overview')
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const dashboard = useQuery({
    queryKey: ['coordinator-dashboard'],
    queryFn: () => api.get<CoordinatorDashboard>('/coordinator/dashboard'),
  })

  const decide = useMutation({
    mutationFn: ({ clubId, membershipId, status }: DecisionVariables) =>
      api.patch<ClubMember>(`/clubs/${clubId}/members/${membershipId}`, { status }),
    onSuccess: (_member, variables) => {
      toast.success(variables.status === 'approved' ? 'Membership approved' : 'Request rejected')
      void queryClient.invalidateQueries({ queryKey: ['coordinator-dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['club-members'] })
      void queryClient.invalidateQueries({ queryKey: ['coordinated-clubs'] })
      void queryClient.invalidateQueries({ queryKey: ['clubs'] })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const firstName = user?.student?.fullName?.split(' ')[0] ?? 'there'
  const data = dashboard.data
  const nextEvent = data?.upcomingEvents?.[0]

  if (dashboard.isLoading) {
    return (
      <div className="space-y-7">
        <PageHeader eyebrow="Coordinator studio" title="Overview" />
        <PageSkeleton />
      </div>
    )
  }

  if (dashboard.isError) {
    return (
      <div className="space-y-7">
        <PageHeader eyebrow="Coordinator studio" title="Your coordinator dashboard" />
        <ErrorState
          title="We could not load your dashboard"
          message={errorMessage(dashboard.error)}
          onRetry={() => dashboard.refetch()}
        />
      </div>
    )
  }

  const stats = data?.stats
  const clubs = data?.clubs ?? []
  const pendingMembers = data?.pendingMembers ?? []
  const upcomingEvents = data?.upcomingEvents ?? []
  const recentFeedback = data?.recentFeedback ?? []

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={`Coordinator studio · ${formatDate(new Date(), 'EEEE, d MMMM')}`}
        title={`${greeting()}, ${firstName}.`}
        description="Your clubs, the events you are running and the people waiting on a decision."
        actions={
          <>
            <Link to="/coordinator/members" className={buttonStyles({ variant: 'secondary' })}>
              <Users className="h-4 w-4" /> Members
            </Link>
            <Link to="/coordinator/events/new" className={buttonStyles({})}>
              <CalendarPlus className="h-4 w-4" /> New event
            </Link>
          </>
        }
      />

      <section className="relative overflow-hidden rounded-[2rem] bg-ink-950 p-6 text-white shadow-card sm:p-8">
        <div className="surface-grid absolute inset-0 opacity-20" aria-hidden />
        <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-brand-500/25 blur-3xl" aria-hidden />
        <div className="absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-acid-300/10 blur-3xl" aria-hidden />
        <div className="relative grid gap-7 lg:grid-cols-[1.25fr_0.75fr] lg:items-center">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[0.625rem] font-bold uppercase tracking-[0.14em] text-acid-200">
              <span className="h-1.5 w-1.5 rounded-full bg-acid-300" /> Coordinator studio
            </p>
            <h2 className="display-title mt-4 max-w-xl text-3xl leading-[1.08] text-white sm:text-4xl">
              {nextEvent ? (
                <>
                  Next on your calendar: <span className="italic text-acid-200">{nextEvent.title}</span>
                </>
              ) : (
                <>
                  Shape the next <span className="italic text-acid-200">campus moment</span>.
                </>
              )}
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-white/55">
              {nextEvent
                ? `${nextEvent.clubName} · ${formatDate(nextEvent.eventDate, 'EEE, d MMM')} at ${formatTime(nextEvent.eventDate)} · ${nextEvent.venueName}`
                : 'Create an event, review membership requests and keep your club moving.'}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {nextEvent ? (
                <Link
                  to={`/coordinator/events/${nextEvent.eventId}/attendance`}
                  className={buttonStyles({ variant: 'acid' })}
                >
                  Manage attendance <ArrowRight className="h-4 w-4" />
                </Link>
              ) : (
                <Link to="/coordinator/events/new" className={buttonStyles({ variant: 'acid' })}>
                  Create an event <ArrowRight className="h-4 w-4" />
                </Link>
              )}
              <Link
                to="/coordinator/events"
                className="inline-flex h-10 items-center gap-2 rounded-full border border-white/15 px-4 text-[0.8125rem] font-semibold text-white/80 transition-colors hover:bg-white/10"
              >
                All my events
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-5 backdrop-blur-sm">
            <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-white/40">
              Your coordinated clubs
            </p>
            {clubs.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {clubs.map((club) => (
                  <Link
                    key={club.clubId}
                    to="/coordinator/members"
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/80 transition-colors hover:border-acid-300/40 hover:text-acid-200"
                  >
                    <Sparkles className="h-3 w-3 text-acid-300" />
                    {club.name}
                  </Link>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm leading-relaxed text-white/55">
                No clubs are assigned to you yet. An administrator can make you a club coordinator.
              </p>
            )}
            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <div className="rounded-xl border border-white/10 bg-white/[0.05] p-3">
                <p className="text-xl font-bold tracking-[-0.03em] text-white">{stats?.totalEvents ?? 0}</p>
                <p className="mt-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-white/40">
                  Events managed
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.05] p-3">
                <p className="text-xl font-bold tracking-[-0.03em] text-white">{stats?.approvedMembers ?? 0}</p>
                <p className="mt-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-white/40">
                  Approved members
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Events"
          value={stats?.totalEvents ?? 0}
          hint={`${stats?.publishedEvents ?? 0} published · ${stats?.pendingEvents ?? 0} pending`}
          icon={<CalendarDays className="h-4 w-4" />}
          to="/coordinator/events"
        />
        <StatCard
          label="Members"
          value={stats?.approvedMembers ?? 0}
          hint="Approved across your clubs"
          icon={<Users className="h-4 w-4" />}
          to="/coordinator/members"
        />
        <StatCard
          label="Pending requests"
          value={stats?.pendingMembers ?? 0}
          hint={stats && stats.pendingMembers > 0 ? 'Waiting for your decision' : 'All caught up'}
          icon={<ClipboardList className="h-4 w-4" />}
          tone={stats && stats.pendingMembers > 0 ? 'brand' : 'default'}
          to="/coordinator/members"
        />
        <StatCard
          label="Average rating"
          value={stats && stats.averageRating > 0 ? stats.averageRating.toFixed(1) : '—'}
          hint={`${stats?.certificatesIssued ?? 0} certificates issued`}
          icon={<Star className="h-4 w-4" />}
          tone="acid"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Pending membership requests"
              description="Approve to add them to the club, or reject to close the request."
              action={
                <Link to="/coordinator/members" className="text-xs font-semibold text-brand-700 hover:underline">
                  Review all
                </Link>
              }
            />
            <CardContent className="space-y-3 pt-4">
              {pendingMembers.length > 0 ? (
                pendingMembers.map((member) => {
                  const approving =
                    decide.isPending &&
                    decide.variables?.membershipId === member.membershipId &&
                    decide.variables.status === 'approved'
                  const rejecting =
                    decide.isPending &&
                    decide.variables?.membershipId === member.membershipId &&
                    decide.variables.status === 'rejected'
                  return (
                    <div
                      key={member.membershipId}
                      className="flex flex-col gap-3 rounded-2xl border border-ink-100 p-3.5 sm:flex-row sm:items-center"
                    >
                      <Avatar name={member.fullName} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink-900">{member.fullName}</p>
                        <p className="mt-0.5 truncate text-xs text-ink-500">
                          {member.clubName} · {member.enrollmentNumber}
                        </p>
                        <p className="mt-0.5 text-[0.6875rem] text-ink-400">
                          Requested {relativeTime(member.requestedAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            decide.mutate({
                              clubId: member.clubId,
                              membershipId: member.membershipId,
                              status: 'rejected',
                            })
                          }
                          loading={rejecting}
                          disabled={decide.isPending && !rejecting}
                          leftIcon={<X className="h-3.5 w-3.5" />}
                        >
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            decide.mutate({
                              clubId: member.clubId,
                              membershipId: member.membershipId,
                              status: 'approved',
                            })
                          }
                          loading={approving}
                          disabled={decide.isPending && !approving}
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
                  icon={<ClipboardList className="h-5 w-5" />}
                  title="No pending requests"
                  description="New membership requests will show up here for a quick decision."
                  action={
                    <Link to="/coordinator/members" className={buttonStyles({ size: 'sm', variant: 'secondary' })}>
                      Open member roster
                    </Link>
                  }
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader
              title="Upcoming events"
              description="Your next published events, closest first."
              action={
                <Link to="/coordinator/events" className="text-xs font-semibold text-brand-700 hover:underline">
                  View all
                </Link>
              }
            />
            <CardContent className="space-y-3 pt-4">
              {upcomingEvents.length > 0 ? (
                upcomingEvents.map((event) => {
                  const date = formatDate(event.eventDate, 'MMM')
                  const day = formatDate(event.eventDate, 'd')
                  return (
                    <div
                      key={event.eventId}
                      className="flex flex-col gap-3 rounded-2xl border border-ink-100 p-3.5 sm:flex-row sm:items-center"
                    >
                      <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-ink-950 text-white">
                        <span className="text-[0.5rem] font-bold uppercase tracking-[0.1em] text-acid-300">
                          {date}
                        </span>
                        <span className="text-base font-bold leading-none">{day}</span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink-900">{event.title}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                          <span>{event.clubName}</span>
                          <span>{eventDateLabel(event.eventDate)}</span>
                          <span>{formatTime(event.eventDate)}</span>
                          <span>{event.venueName}</span>
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge status={event.status} />
                        <Link
                          to={`/coordinator/events/${event.eventId}/attendance`}
                          className={buttonStyles({ size: 'sm', variant: 'secondary' })}
                        >
                          Attendance
                        </Link>
                        <Link
                          to={`/coordinator/events/${event.eventId}/edit`}
                          className={buttonStyles({ size: 'sm', variant: 'ghost' })}
                          aria-label={`Edit ${event.title}`}
                        >
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </div>
                  )
                })
              ) : (
                <EmptyState
                  className="py-10"
                  icon={<CalendarPlus className="h-5 w-5" />}
                  title="No upcoming events"
                  description="Publish the next one and it will appear here."
                  action={
                    <Link to="/coordinator/events/new" className={buttonStyles({ size: 'sm' })}>
                      Create an event
                    </Link>
                  }
                />
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Recent feedback" description="What attendees are saying." />
            <CardContent className="space-y-3 pt-4">
              {recentFeedback.length > 0 ? (
                recentFeedback.map((feedback) => (
                  <div key={feedback.feedbackId} className="rounded-2xl border border-ink-100 p-3.5">
                    <div className="flex items-center gap-3">
                      <Avatar name={feedback.studentName} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-ink-900">{feedback.studentName}</p>
                        <p className="text-[0.625rem] text-ink-400">{relativeTime(feedback.createdAt)}</p>
                      </div>
                      <StarRating rating={feedback.rating} />
                    </div>
                    {feedback.comments ? (
                      <p className="mt-2 line-clamp-3 text-[0.8125rem] leading-relaxed text-ink-600">
                        {feedback.comments}
                      </p>
                    ) : (
                      <p className="mt-2 text-[0.8125rem] italic text-ink-400">No comment left.</p>
                    )}
                  </div>
                ))
              ) : (
                <EmptyState
                  className="py-10"
                  icon={<Award className="h-5 w-5" />}
                  title="No feedback yet"
                  description="Feedback appears after attendees rate a completed event."
                />
              )}
            </CardContent>
          </Card>

          <Card className="bg-ink-950 text-white">
            <CardContent className="space-y-3">
              <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.12em] text-acid-200">
                Quick links
              </p>
              <Link
                to="/coordinator/events/new"
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/85 transition-colors hover:bg-white/10"
              >
                Create a new event <ArrowRight className="h-4 w-4 text-acid-300" />
              </Link>
              <Link
                to="/coordinator/events"
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/85 transition-colors hover:bg-white/10"
              >
                Manage my events <ArrowRight className="h-4 w-4 text-acid-300" />
              </Link>
              <Link
                to="/coordinator/members"
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/85 transition-colors hover:bg-white/10"
              >
                Review memberships <ArrowRight className="h-4 w-4 text-acid-300" />
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>

      {dashboard.isFetching && !dashboard.isLoading ? (
        <Skeleton className="h-1 w-full rounded-full" />
      ) : null}
    </div>
  )
}
