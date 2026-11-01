import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, CalendarDays, Check, Clock, Crown, Mail, UserPlus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError, errorMessage } from '@/services/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDate } from '@/lib/utils'
import type { CampusEvent, Club, MembershipRequest } from '@/types'
import { EmptyState, ErrorState, PageHeader, SectionHeading } from '@/components/shared/PageChrome'
import { EventCard } from '@/components/shared/EventCard'
import { Avatar } from '@/components/shared/Avatar'
import { StatusBadge, Badge } from '@/components/ui/Badge'
import { Button, buttonStyles } from '@/components/ui/Button'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'

export default function StudentClubDetailPage() {
  const { id } = useParams<{ id: string }>()
  const clubId = Number(id)
  const validId = Number.isInteger(clubId) && clubId > 0
  const queryClient = useQueryClient()

  const club = useQuery({
    queryKey: ['club', clubId],
    queryFn: () => api.get<Club>(`/clubs/${clubId}`),
    enabled: validId,
  })

  usePageTitle(club.data?.name ?? 'Club')

  const memberships = useQuery({
    queryKey: ['my-memberships'],
    queryFn: () => api.get<MembershipRequest[]>('/me/memberships'),
  })

  const events = useQuery({
    queryKey: ['events', 'club', clubId],
    queryFn: () =>
      api.list<CampusEvent>('/events', {
        clubId,
        upcoming: 'true',
        pageSize: 6,
      }),
    enabled: validId,
  })

  const joinClub = useMutation({
    mutationFn: () => api.post<MembershipRequest>(`/clubs/${clubId}/join`),
    onSuccess: () => {
      toast.success('Join request sent', {
        description: `Your request to join ${club.data?.name ?? 'this club'} is waiting for coordinator review.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['club', clubId] })
      void queryClient.invalidateQueries({ queryKey: ['clubs'] })
      void queryClient.invalidateQueries({ queryKey: ['my-memberships'] })
      void queryClient.invalidateQueries({ queryKey: ['student-dashboard'] })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  if (!validId) {
    return (
      <div className="space-y-6">
        <PageHeader backTo="/student/clubs" eyebrow="Clubs" title="Club not found" />
        <ErrorState
          title="We could not find that club"
          message="The club link is not valid. Return to the directory to pick another club."
        />
        <div>
          <Link to="/student/clubs" className={buttonStyles({ variant: 'secondary' })}>
            Back to clubs
          </Link>
        </div>
      </div>
    )
  }

  if (club.isLoading) {
    return (
      <div className="space-y-7">
        <div className="space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-12 w-80 max-w-full" />
          <Skeleton className="h-4 w-full max-w-2xl" />
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            <Skeleton className="h-36 rounded-3xl" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Skeleton className="h-80 rounded-3xl" />
              <Skeleton className="h-80 rounded-3xl" />
            </div>
          </div>
          <div className="space-y-4">
            <Skeleton className="h-64 rounded-3xl" />
            <Skeleton className="h-48 rounded-3xl" />
          </div>
        </div>
      </div>
    )
  }

  if (club.isError || !club.data) {
    const notFound = club.error instanceof ApiError && club.error.status === 404
    return (
      <div className="space-y-6">
        <PageHeader backTo="/student/clubs" eyebrow="Clubs" title={notFound ? 'Club not found' : 'Club'} />
        <ErrorState
          title={notFound ? 'This club is not available' : 'We could not load this club'}
          message={notFound ? 'It may have been removed or is no longer approved.' : errorMessage(club.error)}
          onRetry={notFound ? undefined : () => club.refetch()}
        />
      </div>
    )
  }

  const data = club.data
  const membership = memberships.data?.find((item) => item.clubId === clubId)
  const membershipStatus = membership?.status ?? data.myStatus ?? null
  const upcomingEvents = events.data?.data ?? []

  return (
    <div className="space-y-7">
      <PageHeader
        backTo="/student/clubs"
        eyebrow="Club"
        title={data.name}
        description={data.description || 'This club has not added a description yet.'}
        actions={
          membershipStatus === 'approved' ? (
            <>
              <Badge tone="success" dot>
                {membership?.role === 'coordinator' ? 'Coordinator' : 'Approved member'}
              </Badge>
              <Link to="/student/events" className={buttonStyles({ variant: 'secondary' })}>
                Club events <ArrowRight className="h-4 w-4" />
              </Link>
            </>
          ) : membershipStatus === 'pending' ? (
            <Badge tone="warning" dot>
              Request pending
            </Badge>
          ) : (
            <Button
              onClick={() => joinClub.mutate()}
              loading={joinClub.isPending}
              leftIcon={<UserPlus className="h-4 w-4" />}
            >
              {membershipStatus === 'rejected' ? 'Request again' : 'Join club'}
            </Button>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Club at a glance" description="Live membership numbers for this club." />
            <CardContent className="pt-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-ink-100 bg-ink-50/60 px-4 py-3">
                  <span className="flex items-center gap-1.5 text-[0.625rem] font-bold uppercase tracking-[0.1em] text-ink-400">
                    <Users className="h-3.5 w-3.5" /> Members
                  </span>
                  <p className="mt-1.5 text-2xl font-bold tracking-[-0.04em] text-ink-950">{data.approvedMembers}</p>
                </div>
                <div className="rounded-2xl border border-ink-100 bg-ink-50/60 px-4 py-3">
                  <span className="flex items-center gap-1.5 text-[0.625rem] font-bold uppercase tracking-[0.1em] text-ink-400">
                    <Clock className="h-3.5 w-3.5" /> Pending
                  </span>
                  <p className="mt-1.5 text-2xl font-bold tracking-[-0.04em] text-ink-950">{data.pendingRequests}</p>
                </div>
                <div className="rounded-2xl border border-ink-100 bg-ink-50/60 px-4 py-3">
                  <span className="flex items-center gap-1.5 text-[0.625rem] font-bold uppercase tracking-[0.1em] text-ink-400">
                    <CalendarDays className="h-3.5 w-3.5" /> Established
                  </span>
                  <p className="mt-2 text-sm font-bold text-ink-950">{formatDate(data.createdAt, 'MMM yyyy')}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <section>
            <SectionHeading
              title="Upcoming events"
              description="The next moments this club is hosting."
              action={
                <Link to="/student/events" className="text-xs font-semibold text-brand-700 hover:underline">
                  Browse all events
                </Link>
              }
            />

            {events.isLoading ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Skeleton className="h-80 rounded-3xl" />
                <Skeleton className="h-80 rounded-3xl" />
              </div>
            ) : events.isError ? (
              <ErrorState
                title="Could not load club events"
                message={errorMessage(events.error)}
                onRetry={() => events.refetch()}
              />
            ) : upcomingEvents.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {upcomingEvents.map((event) => (
                  <EventCard
                    key={event.eventId}
                    event={event}
                    to={`/student/events/${event.eventId}`}
                    actions={
                      <Link
                        to={`/student/events/${event.eventId}`}
                        className={buttonStyles({ size: 'sm', variant: 'secondary' })}
                      >
                        Details <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    }
                  />
                ))}
              </div>
            ) : (
              <Card>
                <EmptyState
                  icon={<CalendarDays className="h-6 w-6" />}
                  title="No upcoming events"
                  description="This club has nothing on the calendar yet. Check back soon."
                  action={
                    <Link to="/student/events" className={buttonStyles({ size: 'sm', variant: 'secondary' })}>
                      Browse events
                    </Link>
                  }
                />
              </Card>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <Card className="overflow-hidden">
            <div className="hero-wash relative px-6 py-6 text-white">
              <div className="surface-grid absolute inset-0 opacity-20" aria-hidden />
              <div className="relative">
                <p className="eyebrow text-white/45">Your membership</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {membershipStatus ? (
                    <StatusBadge status={membershipStatus} />
                  ) : (
                    <Badge tone="neutral">Not a member</Badge>
                  )}
                  {membership?.role === 'coordinator' ? <Badge tone="brand">Coordinator</Badge> : null}
                </div>
                <p className="mt-3 text-sm leading-relaxed text-white/60">
                  {membershipStatus === 'approved'
                    ? 'You are part of this club. Watch this page for new events.'
                    : membershipStatus === 'pending'
                      ? 'A coordinator is reviewing your request. You will see the decision here.'
                      : membershipStatus === 'rejected'
                        ? 'Your previous request was declined, but you can ask to join again.'
                        : 'Join to follow the club and register for its events.'}
                </p>

                {membershipStatus !== 'approved' && membershipStatus !== 'pending' ? (
                  <Button
                    variant="acid"
                    className="mt-4 w-full"
                    onClick={() => joinClub.mutate()}
                    loading={joinClub.isPending}
                    leftIcon={<UserPlus className="h-4 w-4" />}
                  >
                    {membershipStatus === 'rejected' ? 'Request again' : 'Join this club'}
                  </Button>
                ) : null}

                <div className="mt-4 space-y-1 text-[0.6875rem] text-white/45">
                  {membership?.requestedAt ? <p>Requested {formatDate(membership.requestedAt)}</p> : null}
                  {membership?.joinedAt ? (
                    <p className="flex items-center gap-1.5">
                      <Check className="h-3 w-3 text-acid-300" /> Joined {formatDate(membership.joinedAt)}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
            <CardContent className="space-y-3 pt-5">
              <p className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-ink-400">Coordinator</p>
              {data.coordinatorName ? (
                <div className="flex items-center gap-3">
                  <Avatar name={data.coordinatorName} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-900">{data.coordinatorName}</p>
                    {data.coordinatorEmail ? (
                      <a
                        href={`mailto:${data.coordinatorEmail}`}
                        className="mt-0.5 flex items-center gap-1 text-xs text-brand-700 hover:underline"
                      >
                        <Mail className="h-3 w-3" /> {data.coordinatorEmail}
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="flex items-center gap-1.5 text-sm text-ink-500">
                  <Crown className="h-4 w-4 text-ink-400" /> No coordinator assigned yet.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Good to know" description="Membership rules at a glance." />
            <CardContent className="space-y-2.5 pt-4 text-sm text-ink-500">
              <p>Requests are reviewed by a club coordinator before you become a member.</p>
              <p>Approved members can register for the club's published events.</p>
              <p>If a request is declined, you may ask to join again later.</p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  )
}
