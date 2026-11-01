import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  Award,
  CalendarClock,
  CalendarDays,
  CalendarX2,
  CircleAlert,
  Clock3,
  MapPin,
  MessageSquareQuote,
  Ticket,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError, errorMessage } from '@/services/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDate, formatDateTime, formatTime } from '@/lib/utils'
import { feedbackSchema, type FeedbackFormValues } from '@/lib/validation'
import type { CampusEvent, Feedback, Registration, RegistrationSummary } from '@/types'
import { ErrorState, PageHeader, SectionHeading } from '@/components/shared/PageChrome'
import { StarRating, StarRatingInput } from '@/components/shared/Avatar'
import { CapacityBar } from '@/components/shared/CapacityBar'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import { Button, buttonStyles } from '@/components/ui/Button'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Textarea } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Skeleton'

export default function StudentEventDetailPage() {
  const { id } = useParams<{ id: string }>()
  const eventId = Number(id)
  const validId = Number.isInteger(eventId) && eventId > 0

  const queryClient = useQueryClient()
  const [cancelOpen, setCancelOpen] = useState(false)

  const eventQuery = useQuery({
    queryKey: ['event', eventId],
    queryFn: () => api.get<CampusEvent>(`/events/${eventId}`),
    enabled: validId,
  })

  usePageTitle(eventQuery.data?.title ?? 'Event details')

  const registrationsQuery = useQuery({
    queryKey: ['my-registrations', 'lookup'],
    queryFn: () => api.list<Registration>('/me/registrations', { page: 1, pageSize: 100 }),
  })

  const ownRegistration =
    registrationsQuery.data?.data.find((registration) => registration.eventId === eventId) ?? null

  const eventStarted = eventQuery.data
    ? new Date(eventQuery.data.eventDate).getTime() <= Date.now()
    : false
  const confirmedFromEvent = eventQuery.data?.myRegistration?.status === 'confirmed'
  const confirmedFromList = ownRegistration?.status === 'confirmed'

  const feedbackQuery = useQuery({
    queryKey: ['event-feedback', eventId],
    queryFn: () => api.get<Feedback[]>(`/events/${eventId}/feedback`),
    enabled: validId && (confirmedFromEvent || confirmedFromList) && eventStarted,
    retry: false,
  })

  const feedbackForm = useForm<FeedbackFormValues>({
    resolver: zodResolver(feedbackSchema),
    defaultValues: { rating: 5, comments: '' },
  })

  const invalidateEventData = (targetId: number) => {
    void queryClient.invalidateQueries({ queryKey: ['event', targetId] })
    void queryClient.invalidateQueries({ queryKey: ['events'] })
    void queryClient.invalidateQueries({ queryKey: ['my-registrations'] })
    void queryClient.invalidateQueries({ queryKey: ['student-dashboard'] })
    void queryClient.invalidateQueries({ queryKey: ['event-feedback', targetId] })
  }

  const register = useMutation({
    mutationFn: () => api.post<Registration>(`/events/${eventId}/register`),
    onSuccess: (registration) => {
      toast.success('Seat confirmed', {
        description: `You are registered for ${registration.eventTitle}.`,
      })
      invalidateEventData(eventId)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const cancel = useMutation({
    mutationFn: (registrationId: number) => api.delete(`/registrations/${registrationId}`),
    onSuccess: () => {
      toast.success('Registration cancelled', { description: 'Your seat has been released.' })
      setCancelOpen(false)
      invalidateEventData(eventId)
    },
    onError: (error) => {
      toast.error(errorMessage(error))
      setCancelOpen(false)
    },
  })

  const submitFeedback = useMutation({
    mutationFn: (values: FeedbackFormValues) =>
      api.post<Feedback>(`/events/${eventId}/feedback`, {
        rating: values.rating,
        comments: values.comments ?? '',
      }),
    onSuccess: () => {
      toast.success('Thanks for the feedback', {
        description: 'Your rating helps clubs make the next event even better.',
      })
      feedbackForm.reset({ rating: 5, comments: '' })
      void queryClient.invalidateQueries({ queryKey: ['event-feedback', eventId] })
      void queryClient.invalidateQueries({ queryKey: ['event', eventId] })
      void queryClient.invalidateQueries({ queryKey: ['events'] })
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        if (error.fields.rating) {
          feedbackForm.setError('rating', { type: 'server', message: error.fields.rating })
        }
        if (error.fields.comments) {
          feedbackForm.setError('comments', { type: 'server', message: error.fields.comments })
        }
      }
      toast.error(errorMessage(error))
    },
  })

  if (!validId) {
    return (
      <div className="space-y-6">
        <PageHeader backTo="/student/events" eyebrow="Events" title="Event not found" />
        <ErrorState
          title="We could not find that event"
          message="The event link is not valid. Return to the event list to pick another one."
        />
        <div>
          <Link to="/student/events" className={buttonStyles({ variant: 'secondary' })}>
            Back to events
          </Link>
        </div>
      </div>
    )
  }

  if (eventQuery.isLoading) {
    return (
      <div className="space-y-7">
        <div className="space-y-3">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-12 w-96 max-w-full" />
          <Skeleton className="h-4 w-full max-w-2xl" />
        </div>
        <Skeleton className="h-52 rounded-[2rem]" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            <Skeleton className="h-44 rounded-3xl" />
            <Skeleton className="h-64 rounded-3xl" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-72 rounded-3xl" />
            <Skeleton className="h-44 rounded-3xl" />
          </div>
        </div>
      </div>
    )
  }

  if (eventQuery.isError || !eventQuery.data) {
    const notFound = eventQuery.error instanceof ApiError && eventQuery.error.status === 404
    return (
      <div className="space-y-6">
        <PageHeader backTo="/student/events" eyebrow="Events" title={notFound ? 'Event not found' : 'Event'} />
        <ErrorState
          title={notFound ? 'This event is not available' : 'We could not load this event'}
          message={
            notFound
              ? 'It may have been removed, or it is no longer published.'
              : errorMessage(eventQuery.error)
          }
          onRetry={notFound ? undefined : () => eventQuery.refetch()}
        />
      </div>
    )
  }

  const data = eventQuery.data
  const registration = ownRegistration

  const myRegistration: RegistrationSummary | null = registration
    ? {
        registrationId: registration.registrationId,
        status: registration.status,
        registeredAt: registration.registeredAt,
        cancelledAt: registration.cancelledAt ?? null,
        attendanceStatus: registration.attendanceStatus ?? null,
        certificateCode: registration.certificateCode ?? null,
      }
    : data.myRegistration ?? null

  const confirmed = myRegistration?.status === 'confirmed'
  const started = new Date(data.eventDate).getTime() <= Date.now()
  const deadlinePassed = new Date(data.registrationDeadline).getTime() < Date.now()
  const full = data.seatsRemaining <= 0 || data.confirmedRegistrations >= data.capacity
  const published = data.status === 'published'
  const canRegister = published && !started && !deadlinePassed && !full && !confirmed
  const canCancel = Boolean(
    confirmed && myRegistration && !myRegistration.attendanceStatus && data.status !== 'completed',
  )

  const myFeedback = feedbackQuery.data?.[0] ?? null
  const feedbackOpen = confirmed && started

  const registrationAction = () => {
    if (confirmed && myRegistration) {
      if (!canCancel) {
        return (
          <Badge tone="success" dot>
            Registration confirmed
          </Badge>
        )
      }
      return (
        <Button
          variant="secondary"
          loading={cancel.isPending}
          leftIcon={<CalendarX2 className="h-4 w-4" />}
          onClick={() => setCancelOpen(true)}
        >
          Cancel registration
        </Button>
      )
    }

    if (myRegistration?.status === 'waitlisted') {
      return <Badge tone="warning">On the waitlist</Badge>
    }
    if (data.status === 'completed') {
      return <Badge tone="neutral">Event completed</Badge>
    }
    if (!published) {
      return <Badge tone="neutral">Registration closed</Badge>
    }
    if (started) {
      return <Badge tone="neutral">Event already started</Badge>
    }
    if (full) {
      return <Badge tone="danger">Event full</Badge>
    }
    if (deadlinePassed) {
      return <Badge tone="neutral">Deadline passed</Badge>
    }

    return (
      <Button
        loading={register.isPending}
        disabled={!canRegister}
        leftIcon={<Ticket className="h-4 w-4" />}
        onClick={() => register.mutate()}
      >
        {myRegistration?.status === 'cancelled' ? 'Register again' : 'Register for this event'}
      </Button>
    )
  }

  return (
    <div className="space-y-7">
      <PageHeader
        backTo="/student/events"
        eyebrow={`${data.clubName} · ${formatDate(data.eventDate, 'EEE, d MMM yyyy')}`}
        title={data.title}
        description={`Hosted by ${data.clubName} at ${data.venueName}.`}
        actions={
          <>
            <StatusBadge status={data.status} />
            {registrationAction()}
          </>
        }
      />

      <section className="relative overflow-hidden rounded-[2rem] bg-ink-950 p-6 text-white shadow-card sm:p-8">
        <div className="surface-grid absolute inset-0 opacity-20" aria-hidden />
        <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-brand-500/25 blur-3xl" aria-hidden />
        <div className="absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-acid-300/10 blur-3xl" aria-hidden />

        <div className="relative grid gap-6 lg:grid-cols-[1.35fr_0.65fr] lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="acid">{data.status === 'completed' ? 'Past event' : 'Campus event'}</Badge>
              {confirmed ? <Badge tone="success">Registered</Badge> : null}
              {data.feedbackCount > 0 ? (
                <Badge tone="neutral" className="bg-white/10 text-white ring-white/15">
                  {data.feedbackCount} {data.feedbackCount === 1 ? 'review' : 'reviews'}
                </Badge>
              ) : null}
            </div>

            <h2 className="display-title mt-4 text-3xl leading-[1.05] text-white sm:text-4xl">
              {formatDate(data.eventDate, 'EEEE, d MMMM')}
            </h2>

            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/65">
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="h-4 w-4 text-acid-300" /> {formatTime(data.eventDate)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-acid-300" /> {data.venueName}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-4 w-4 text-acid-300" /> {data.confirmedRegistrations} going
              </span>
            </div>

            <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3.5 py-1.5 text-xs text-white/65">
              <CalendarClock className="h-3.5 w-3.5 text-acid-300" />
              {deadlinePassed
                ? `Registration closed on ${formatDateTime(data.registrationDeadline)}`
                : `Register by ${formatDateTime(data.registrationDeadline)}`}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.055] p-5 backdrop-blur-sm">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-white/45">Seats filled</p>
                <p className="mt-1 text-3xl font-bold tracking-[-0.04em] text-white">
                  {data.confirmedRegistrations}
                  <span className="ml-1 text-base font-semibold text-white/40">/ {data.capacity}</span>
                </p>
              </div>
              <span className={full ? 'text-sm font-semibold text-rose-300' : 'text-sm font-semibold text-acid-200'}>
                {full ? 'Full' : `${data.seatsRemaining} left`}
              </span>
            </div>
            <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-acid-300 transition-all duration-500"
                style={{
                  width: `${data.capacity > 0 ? Math.min(100, Math.round((data.confirmedRegistrations / data.capacity) * 100)) : 0}%`,
                }}
              />
            </div>
            <p className="mt-3 text-[0.6875rem] text-white/45">
              {data.totalRegistrations} registrations in total · {data.venueName} holds {data.venueCapacity}
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="About this event" description={`Presented by ${data.clubName}.`} />
            <CardContent className="pt-4">
              <p className="whitespace-pre-line text-sm leading-relaxed text-ink-600">
                {data.description || 'The organisers have not added a description for this event yet.'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Event details" description="Everything you need before you show up." />
            <CardContent className="grid gap-4 pt-5 sm:grid-cols-2">
              <div className="rounded-2xl border border-ink-100 bg-ink-50/60 px-4 py-3">
                <span className="flex items-center gap-1.5 text-[0.625rem] font-bold uppercase tracking-[0.1em] text-ink-400">
                  <CalendarDays className="h-3.5 w-3.5" /> Date
                </span>
                <p className="mt-1.5 text-sm font-semibold text-ink-900">
                  {formatDate(data.eventDate, 'EEEE, d MMMM yyyy')}
                </p>
                <p className="mt-0.5 text-xs text-ink-500">{formatTime(data.eventDate)}</p>
              </div>

              <div className="rounded-2xl border border-ink-100 bg-ink-50/60 px-4 py-3">
                <span className="flex items-center gap-1.5 text-[0.625rem] font-bold uppercase tracking-[0.1em] text-ink-400">
                  <MapPin className="h-3.5 w-3.5" /> Venue
                </span>
                <p className="mt-1.5 text-sm font-semibold text-ink-900">{data.venueName}</p>
                <p className="mt-0.5 text-xs text-ink-500">Seats {data.venueCapacity}</p>
              </div>

              <div className="rounded-2xl border border-ink-100 bg-ink-50/60 px-4 py-3">
                <span className="flex items-center gap-1.5 text-[0.625rem] font-bold uppercase tracking-[0.1em] text-ink-400">
                  <CalendarClock className="h-3.5 w-3.5" /> Registration deadline
                </span>
                <p className="mt-1.5 text-sm font-semibold text-ink-900">
                  {formatDateTime(data.registrationDeadline)}
                </p>
                <p className="mt-0.5 text-xs text-ink-500">
                  {deadlinePassed ? 'Closed' : 'Register before this time'}
                </p>
              </div>

              <div className="rounded-2xl border border-ink-100 bg-ink-50/60 px-4 py-3">
                <span className="flex items-center gap-1.5 text-[0.625rem] font-bold uppercase tracking-[0.1em] text-ink-400">
                  <Users className="h-3.5 w-3.5" /> Club
                </span>
                <Link
                  to={`/student/clubs/${data.clubId}`}
                  className="mt-1.5 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline"
                >
                  {data.clubName} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <p className="mt-0.5 text-xs text-ink-500">Hosted by this club</p>
              </div>

              <div className="rounded-2xl border border-ink-100 bg-ink-50/60 px-4 py-3 sm:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-ink-400">
                      Capacity
                    </span>
                    <p className="mt-1.5 text-sm font-semibold text-ink-900">
                      {data.confirmedRegistrations} of {data.capacity} seats filled
                    </p>
                  </div>
                  <CapacityBar confirmed={data.confirmedRegistrations} capacity={data.capacity} className="w-full sm:w-56" />
                </div>
              </div>
            </CardContent>
          </Card>

          {feedbackOpen ? (
            <Card>
              <CardHeader
                title="Event feedback"
                description="Tell the organisers how it went. Only you and the club can see your response."
                action={myFeedback ? <Badge tone="success">Submitted</Badge> : null}
              />
              <CardContent className="pt-5">
                {myFeedback ? (
                  <div className="rounded-2xl border border-ink-100 bg-ink-50/50 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <StarRating rating={myFeedback.rating} size="md" />
                      <span className="text-xs text-ink-400">{formatDate(myFeedback.createdAt, 'd MMM yyyy')}</span>
                    </div>
                    <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink-600">
                      {myFeedback.comments || 'You did not add any comments.'}
                    </p>
                    <p className="mt-4 text-xs text-brand-700">Thanks for sharing your experience.</p>
                  </div>
                ) : feedbackQuery.isLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-24 rounded-2xl" />
                  </div>
                ) : feedbackQuery.isError ? (
                  <div className="flex flex-col items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900">
                    <p className="inline-flex items-center gap-2">
                      <CircleAlert className="h-4 w-4 shrink-0" /> Feedback is not available right now.
                    </p>
                    <Button size="sm" variant="secondary" onClick={() => feedbackQuery.refetch()}>
                      Try again
                    </Button>
                  </div>
                ) : (
                  <form
                    className="space-y-5"
                    noValidate
                    onSubmit={feedbackForm.handleSubmit((values) => submitFeedback.mutate(values))}
                  >
                    <div className="space-y-2">
                      <p className="text-[0.8125rem] font-semibold text-ink-800">
                        How would you rate this event?
                      </p>
                      <StarRatingInput
                        value={Number(feedbackForm.watch('rating') ?? 0)}
                        onChange={(value) =>
                          feedbackForm.setValue('rating', value, { shouldValidate: true, shouldDirty: true })
                        }
                      />
                      {feedbackForm.formState.errors.rating?.message ? (
                        <p className="text-xs font-medium text-rose-600" role="alert">
                          {feedbackForm.formState.errors.rating.message}
                        </p>
                      ) : null}
                    </div>

                    <Textarea
                      label="Comments"
                      placeholder="What stood out? What could be better next time?"
                      hint="Optional, up to 1000 characters."
                      error={feedbackForm.formState.errors.comments?.message}
                      {...feedbackForm.register('comments')}
                    />

                    <Button
                      type="submit"
                      loading={submitFeedback.isPending}
                      leftIcon={<MessageSquareQuote className="h-4 w-4" />}
                    >
                      Submit feedback
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          ) : confirmed && !started ? (
            <Card>
              <CardContent className="flex items-start gap-3 pt-6">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-ink-100 text-ink-500">
                  <CircleAlert className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink-900">Feedback opens after the event starts</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-ink-500">
                    Come back once the event is underway to rate it and leave a note for the organisers.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {!confirmed ? (
            <Card>
              <CardHeader title="Ratings from attendees" description="Feedback shared by students who attended." />
              <CardContent className="flex flex-wrap items-center gap-3 pt-4">
                <StarRating rating={data.averageRating} count={data.feedbackCount} size="md" />
                <p className="text-sm text-ink-500">
                  {data.feedbackCount > 0
                    ? `${data.feedbackCount} ${data.feedbackCount === 1 ? 'attendee has' : 'attendees have'} rated this event.`
                    : 'No ratings yet — be the first once you attend.'}
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-6">
          <Card className="overflow-hidden">
            <div className="hero-wash relative px-6 py-6 text-white">
              <div className="surface-grid absolute inset-0 opacity-20" aria-hidden />
              <div className="relative">
                <p className="eyebrow text-white/45">Your registration</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {myRegistration ? (
                    <StatusBadge status={myRegistration.status} />
                  ) : (
                    <Badge tone="neutral">Not registered</Badge>
                  )}
                  {myRegistration?.attendanceStatus ? (
                    <StatusBadge status={myRegistration.attendanceStatus} />
                  ) : null}
                </div>
                <p className="mt-3 text-sm leading-relaxed text-white/60">
                  {confirmed
                    ? 'Your seat is confirmed. Bring your student ID and arrive a little early.'
                    : myRegistration?.status === 'cancelled'
                      ? 'You cancelled this registration. You can register again while seats last.'
                      : myRegistration?.status === 'waitlisted'
                        ? 'You are on the waitlist. A coordinator will confirm your seat if one opens up.'
                        : 'Register to reserve a seat and receive attendance and certificate updates.'}
                </p>

                {myRegistration ? (
                  <p className="mt-4 text-[0.6875rem] text-white/45">
                    {confirmed ? 'Registered' : 'Updated'} {formatDate(myRegistration.registeredAt)}
                  </p>
                ) : null}
              </div>
            </div>

            <CardContent className="space-y-3 pt-5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-ink-500">Attendance</span>
                {myRegistration?.attendanceStatus ? (
                  <StatusBadge status={myRegistration.attendanceStatus} />
                ) : (
                  <span className="text-xs text-ink-400">Not recorded</span>
                )}
              </div>

              {myRegistration?.certificateCode ? (
                <div className="rounded-2xl border border-brand-200 bg-brand-50/60 p-3.5">
                  <p className="flex items-center gap-1.5 text-[0.625rem] font-bold uppercase tracking-[0.1em] text-brand-800">
                    <Award className="h-3.5 w-3.5" /> Certificate issued
                  </p>
                  <p className="mt-1.5 break-all font-mono text-[0.8125rem] font-semibold tracking-[0.08em] text-brand-800">
                    {myRegistration.certificateCode}
                  </p>
                  <Link
                    to="/student/certificates"
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
                  >
                    View certificate <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              ) : confirmed ? (
                <p className="rounded-2xl border border-ink-100 bg-ink-50/60 px-3.5 py-3 text-xs leading-relaxed text-ink-500">
                  {started
                    ? 'Certificates are issued once a coordinator marks you present. Check back after the attendance register is saved.'
                    : 'A certificate is issued after the event when your attendance is marked present.'}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Seats & interest" description="Live numbers for this event." />
            <CardContent className="space-y-4 pt-4">
              <CapacityBar confirmed={data.confirmedRegistrations} capacity={data.capacity} />
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-ink-100 px-3.5 py-3">
                  <p className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-ink-400">Confirmed</p>
                  <p className="mt-1 text-xl font-bold tracking-[-0.03em] text-ink-950">
                    {data.confirmedRegistrations}
                  </p>
                </div>
                <div className="rounded-2xl border border-ink-100 px-3.5 py-3">
                  <p className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-ink-400">Seats left</p>
                  <p className="mt-1 text-xl font-bold tracking-[-0.03em] text-ink-950">{data.seatsRemaining}</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-ink-100 pt-3">
                <span className="text-xs text-ink-500">Attendee rating</span>
                <StarRating rating={data.averageRating} count={data.feedbackCount} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Good to know" description="How registration and certificates work." />
            <CardContent className="space-y-2.5 pt-4 text-sm text-ink-500">
              <p>Registration is first come, first served until the capacity is reached.</p>
              <p>You can cancel a confirmed seat from this page at any time before attendance is recorded.</p>
              <p>Certificates are issued automatically when a coordinator marks you present.</p>
            </CardContent>
          </Card>

          {!confirmed && data.feedbackCount > 0 ? (
            <div className="rounded-3xl border border-ink-200/70 bg-white px-5 py-4 shadow-card">
              <SectionHeading title="Attendee rating" />
              <StarRating rating={data.averageRating} count={data.feedbackCount} size="md" />
            </div>
          ) : null}
        </aside>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => {
          if (myRegistration) cancel.mutate(myRegistration.registrationId)
        }}
        title="Cancel your registration?"
        description={
          <>
            Your seat for <span className="font-semibold text-ink-800">{data.title}</span> will be released
            and offered to another student. This cannot be undone.
          </>
        }
        confirmLabel="Cancel registration"
        cancelLabel="Keep my seat"
        tone="danger"
        loading={cancel.isPending}
      />
    </div>
  )
}
