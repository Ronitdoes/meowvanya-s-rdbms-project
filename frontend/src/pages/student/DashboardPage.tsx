import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  ArrowUpRight,
  Award,
  CalendarDays,
  CalendarPlus,
  ClipboardList,
  Sparkles,
  Users,
} from 'lucide-react'
import { api } from '@/services/api'
import { useAuth } from '@/context/AuthContext'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDate, formatTime } from '@/lib/utils'
import type { MembershipRequest, StudentDashboard } from '@/types'
import { PageHeader, EmptyState, ErrorState } from '@/components/shared/PageChrome'
import { StatCard } from '@/components/shared/StatCard'
import { EventCard } from '@/components/shared/EventCard'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { buttonStyles } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { Avatar } from '@/components/shared/Avatar'

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function StudentDashboardPage() {
  usePageTitle('Dashboard')
  const { user } = useAuth()

  const dashboard = useQuery({
    queryKey: ['student-dashboard'],
    queryFn: () => api.get<StudentDashboard>('/me/dashboard'),
  })

  const memberships = useQuery({
    queryKey: ['my-memberships'],
    queryFn: () => api.get<MembershipRequest[]>('/me/memberships'),
  })

  const firstName = user?.student?.fullName?.split(' ')[0] ?? 'there'
  const data = dashboard.data
  const nextEvent = data?.upcomingEvents?.[0]
  const today = formatDate(new Date(), 'EEEE, d MMMM')

  if (dashboard.isError) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Student portal" title="Your dashboard" />
        <ErrorState
          title="We could not load your dashboard"
          message="The API did not respond. Check that the backend is running and try again."
          onRetry={() => dashboard.refetch()}
        />
      </div>
    )
  }

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={`Student portal · ${today}`}
        title={`${greeting()}, ${firstName}.`}
        description="Here is what is happening across your clubs and the events you have signed up for."
        actions={
          <>
            <Link to="/student/events" className={buttonStyles({ variant: 'secondary' })}>
              Browse events
            </Link>
            <Link to="/student/clubs" className={buttonStyles({})}>
              <Sparkles className="h-4 w-4" /> Find a club
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
              <span className="h-1.5 w-1.5 rounded-full bg-acid-300" /> Campus pulse
            </p>
            <h2 className="display-title mt-4 max-w-xl text-3xl leading-[1.08] text-white sm:text-4xl">
              {nextEvent ? (
                <>
                  Next up: <span className="italic text-acid-200">{nextEvent.title}</span>
                </>
              ) : (
                <>
                  Your next campus <span className="italic text-acid-200">moment</span> is waiting.
                </>
              )}
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-white/55">
              {nextEvent
                ? `${nextEvent.clubName} · ${formatDate(nextEvent.eventDate, 'EEE, d MMM')} at ${formatTime(nextEvent.eventDate)} · ${nextEvent.venueName}`
                : 'Browse clubs and upcoming events to find something worth showing up for.'}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {nextEvent ? (
                <Link to={`/student/events/${nextEvent.eventId}`} className={buttonStyles({ variant: 'acid' })}>
                  View event <ArrowRight className="h-4 w-4" />
                </Link>
              ) : null}
              <Link
                to="/student/registrations"
                className="inline-flex h-10 items-center gap-2 rounded-full border border-white/15 px-4 text-[0.8125rem] font-semibold text-white/80 transition-colors hover:bg-white/10"
              >
                My registrations
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { label: 'Clubs joined', value: data?.approvedMemberships ?? '—', icon: <Users className="h-4 w-4" /> },
              { label: 'Going to', value: data?.upcomingRegistrations ?? '—', icon: <CalendarDays className="h-4 w-4" /> },
              { label: 'Certificates', value: data?.certificatesEarned ?? '—', icon: <Award className="h-4 w-4" /> },
              { label: 'All registrations', value: data?.eventsRegistered ?? '—', icon: <ClipboardList className="h-4 w-4" /> },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.055] p-4 backdrop-blur-sm">
                <span className="text-acid-200/80">{item.icon}</span>
                <p className="mt-3 text-2xl font-bold tracking-[-0.04em] text-white">{item.value}</p>
                <p className="mt-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-white/40">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold tracking-[-0.02em] text-ink-900">Upcoming events</h2>
              <p className="mt-0.5 text-sm text-ink-500">Published events from across campus, closest first.</p>
            </div>
            <Link to="/student/events" className="text-xs font-semibold text-brand-700 hover:underline">
              View all
            </Link>
          </div>

          {dashboard.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-80 rounded-3xl" />
              <Skeleton className="h-80 rounded-3xl" />
            </div>
          ) : data && data.upcomingEvents.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {data.upcomingEvents.map((event) => (
                <EventCard
                  key={event.eventId}
                  event={event}
                  to={`/student/events/${event.eventId}`}
                  actions={
                    <Link to={`/student/events/${event.eventId}`} className={buttonStyles({ size: 'sm', variant: 'secondary' })}>
                      Details <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  }
                />
              ))}
            </div>
          ) : (
            <Card>
              <EmptyState
                icon={<CalendarPlus className="h-6 w-6" />}
                title="No upcoming events yet"
                description="New events are published regularly. Check back soon or explore clubs to follow."
                action={
                  <Link to="/student/events" className={buttonStyles({ size: 'sm' })}>
                    Browse events
                  </Link>
                }
              />
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Recent registrations" description="Your latest event sign-ups." />
            <CardContent className="space-y-3 pt-4">
              {dashboard.isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 rounded-2xl" />
                  <Skeleton className="h-16 rounded-2xl" />
                  <Skeleton className="h-16 rounded-2xl" />
                </div>
              ) : data && data.recentRegistrations.length > 0 ? (
                data.recentRegistrations.map((registration) => (
                  <Link
                    key={registration.registrationId}
                    to={`/student/events/${registration.eventId}`}
                    className="flex items-center gap-3 rounded-2xl border border-transparent p-2 transition-colors hover:border-ink-100 hover:bg-ink-50"
                  >
                    <span className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl bg-ink-100">
                      <span className="text-[0.5rem] font-bold uppercase tracking-[0.1em] text-ink-400">
                        {formatDate(registration.eventDate, 'MMM')}
                      </span>
                      <span className="text-sm font-bold leading-none text-ink-800">
                        {formatDate(registration.eventDate, 'd')}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-ink-800">{registration.eventTitle}</span>
                      <span className="mt-0.5 block truncate text-[0.625rem] text-ink-400">{registration.clubName}</span>
                    </span>
                    <StatusBadge status={registration.status} />
                  </Link>
                ))
              ) : (
                <EmptyState
                  className="py-8"
                  icon={<ClipboardList className="h-5 w-5" />}
                  title="No registrations yet"
                  description="Your first event is one click away."
                  action={
                    <Link to="/student/events" className={buttonStyles({ size: 'sm', variant: 'secondary' })}>
                      Find an event
                    </Link>
                  }
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader
              title="Your clubs"
              description="Memberships and requests."
              action={
                <Link to="/student/clubs" className="text-xs font-semibold text-brand-700 hover:underline">
                  Explore
                </Link>
              }
            />
            <CardContent className="space-y-3 pt-4">
              {memberships.isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-14 rounded-2xl" />
                  <Skeleton className="h-14 rounded-2xl" />
                </div>
              ) : memberships.data && memberships.data.length > 0 ? (
                memberships.data.slice(0, 5).map((membership) => (
                  <div key={membership.membershipId} className="flex items-center gap-3 rounded-2xl border border-ink-100 p-2.5">
                    <Avatar name={membership.clubName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-ink-800">{membership.clubName}</p>
                      <p className="mt-0.5 text-[0.625rem] text-ink-400">{membership.role}</p>
                    </div>
                    <StatusBadge status={membership.status} />
                  </div>
                ))
              ) : (
                <EmptyState
                  className="py-8"
                  icon={<Users className="h-5 w-5" />}
                  title="No memberships yet"
                  description="Join a club to see it here."
                  action={
                    <Link to="/student/clubs" className={buttonStyles({ size: 'sm', variant: 'secondary' })}>
                      Browse clubs
                    </Link>
                  }
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Approved clubs"
          value={data?.approvedMemberships ?? 0}
          hint="Active memberships"
          icon={<Users className="h-4 w-4" />}
          to="/student/clubs"
        />
        <StatCard
          label="Pending requests"
          value={data?.pendingMemberships ?? 0}
          hint="Awaiting coordinator review"
          icon={<CalendarDays className="h-4 w-4" />}
          tone={data && data.pendingMemberships > 0 ? 'brand' : 'default'}
        />
        <StatCard
          label="Events registered"
          value={data?.eventsRegistered ?? 0}
          hint="Across all clubs"
          icon={<ClipboardList className="h-4 w-4" />}
          to="/student/registrations"
        />
        <StatCard
          label="Certificates"
          value={data?.certificatesEarned ?? 0}
          hint="Ready to download"
          icon={<Award className="h-4 w-4" />}
          to="/student/certificates"
          tone="acid"
        />
      </div>
    </div>
  )
}
