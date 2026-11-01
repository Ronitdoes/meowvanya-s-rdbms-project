import { useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  CalendarDays,
  Clock3,
  Info,
  MapPin,
  Save,
  Users,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError, errorMessage } from '@/services/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import { eventSchema } from '@/lib/validation'
import {
  formatDate,
  formatTime,
  inputDateTimeValue,
  toISOStringFromInput,
} from '@/lib/utils'
import type { CampusEvent, Club, CreateEventInput, Venue } from '@/types'
import { ErrorState, PageHeader } from '@/components/shared/PageChrome'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import { Button, buttonStyles } from '@/components/ui/Button'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { PageSkeleton } from '@/components/ui/Skeleton'

type EventFormInput = z.input<typeof eventSchema>
type EventFormValues = z.infer<typeof eventSchema>

const defaultValues: EventFormInput = {
  clubId: '',
  venueId: '',
  title: '',
  description: '',
  eventDate: '',
  registrationDeadline: '',
  capacity: '',
}

const serverFieldAliases: Record<string, keyof EventFormInput> = {
  clubId: 'clubId',
  venueId: 'venueId',
  title: 'title',
  description: 'description',
  eventDate: 'eventDate',
  registrationDeadline: 'registrationDeadline',
  capacity: 'capacity',
}

/**
 * Coordinator event lookups have their own endpoint in the contract, but the
 * deployed API may only expose the public `/events/{id}` route. Try the
 * coordinator route first, then fall back.
 */
async function fetchEventForEdit(id: string): Promise<CampusEvent> {
  try {
    return await api.get<CampusEvent>(`/coordinator/events/${id}`)
  } catch (error) {
    if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 405)) {
      throw error
    }
  }
  return api.get<CampusEvent>(`/events/${id}`)
}

export default function CoordinatorEventFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = Boolean(id)
  usePageTitle(isEdit ? 'Edit event' : 'Create event')

  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const clubsQuery = useQuery({
    queryKey: ['coordinated-clubs'],
    queryFn: () => api.get<Club[]>('/me/coordinated-clubs'),
  })

  const venuesQuery = useQuery({
    queryKey: ['venues'],
    queryFn: () => api.get<Venue[]>('/venues'),
  })

  const eventQuery = useQuery({
    queryKey: ['managed-event', id],
    queryFn: () => fetchEventForEdit(id ?? ''),
    enabled: isEdit,
  })

  const form = useForm<EventFormInput, unknown, EventFormValues>({
    resolver: zodResolver(eventSchema),
    defaultValues,
    mode: 'onTouched',
  })

  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = form

  const event = eventQuery.data

  useEffect(() => {
    if (!event) return
    reset({
      clubId: event.clubId,
      venueId: event.venueId,
      title: event.title,
      description: event.description,
      eventDate: inputDateTimeValue(event.eventDate),
      registrationDeadline: inputDateTimeValue(event.registrationDeadline),
      capacity: event.capacity,
    })
  }, [event, reset])

  const clubs = clubsQuery.data ?? []
  const venues = venuesQuery.data ?? []

  const watchedVenueId = Number(watch('venueId'))
  const watchedCapacity = Number(watch('capacity'))
  const watchedTitle = watch('title')
  const watchedClubId = Number(watch('clubId'))
  const watchedEventDate = watch('eventDate')
  const watchedDeadline = watch('registrationDeadline')
  const watchedDescription = watch('description')

  const selectedVenue = venues.find((venue) => venue.venueId === watchedVenueId)
  const selectedClub = clubs.find((club) => club.clubId === watchedClubId)

  const capacityOverVenue =
    selectedVenue !== undefined &&
    Number.isFinite(watchedCapacity) &&
    watchedCapacity > selectedVenue.capacity

  const create = useMutation({
    mutationFn: (payload: CreateEventInput) => api.post<CampusEvent>('/events', payload),
  })

  const update = useMutation({
    mutationFn: (payload: CreateEventInput) => api.patch<CampusEvent>(`/events/${id}`, payload),
  })

  const saving = create.isPending || update.isPending

  const onSubmit = async (values: EventFormValues) => {
    const venue = venues.find((item) => item.venueId === values.venueId)
    if (venue && values.capacity > venue.capacity) {
      setError('capacity', {
        type: 'validate',
        message: `${venue.name} holds at most ${venue.capacity} people.`,
      })
      return
    }

    const payload: CreateEventInput = {
      ...values,
      eventDate: toISOStringFromInput(values.eventDate),
      registrationDeadline: toISOStringFromInput(values.registrationDeadline),
    }

    try {
      if (isEdit) {
        await update.mutateAsync(payload)
        toast.success('Event updated')
      } else {
        await create.mutateAsync(payload)
        toast.success('Event submitted for admin approval')
      }
      void queryClient.invalidateQueries({ queryKey: ['managed-events'] })
      void queryClient.invalidateQueries({ queryKey: ['coordinator-dashboard'] })
      navigate('/coordinator/events')
    } catch (error) {
      if (error instanceof ApiError) {
        for (const [key, message] of Object.entries(error.fields)) {
          const field = serverFieldAliases[key]
          if (field) setError(field, { type: 'server', message })
        }
      }
      toast.error(errorMessage(error))
    }
  }

  if (isEdit && eventQuery.isLoading) {
    return (
      <div className="space-y-7">
        <PageHeader eyebrow="Coordinator studio" title="Edit event" />
        <PageSkeleton />
      </div>
    )
  }

  if (isEdit && eventQuery.isError) {
    return (
      <div className="space-y-7">
        <PageHeader eyebrow="Coordinator studio" title="Edit event" backTo="/coordinator/events" />
        <ErrorState
          title="We could not load this event"
          message={errorMessage(eventQuery.error)}
          onRetry={() => eventQuery.refetch()}
        />
      </div>
    )
  }

  const previewTitle = typeof watchedTitle === 'string' && watchedTitle.trim() ? watchedTitle : 'Untitled event'
  const previewDescription =
    typeof watchedDescription === 'string' && watchedDescription.trim()
      ? watchedDescription.trim()
      : 'Add a short description so students know what to expect.'
  const hasPreviewDate = typeof watchedEventDate === 'string' && watchedEventDate.length > 0

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Coordinator studio"
        title={isEdit ? 'Edit event' : 'Create an event'}
        description={
          isEdit
            ? 'Update the details of your event. Publication status stays with the administrator.'
            : 'Draft the details, choose a venue and submit it for admin approval.'
        }
        backTo="/coordinator/events"
        actions={
          isEdit && event ? <StatusBadge status={event.status} /> : <Badge tone="warning">Pending approval</Badge>
        }
      />

      {isEdit && event?.status === 'rejected' && event.rejectionReason ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-[0.8125rem] leading-relaxed text-rose-900">
          <span className="font-semibold">Rejected by admin:</span> {event.rejectionReason}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader
            title="Event details"
            description="All fields are required unless marked optional."
          />
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  label="Club"
                  required
                  placeholder="Select a club"
                  error={errors.clubId?.message}
                  hint={clubsQuery.isError ? 'Could not load your clubs.' : undefined}
                  disabled={clubsQuery.isLoading || clubs.length === 0}
                  {...register('clubId')}
                >
                  {clubs.map((club) => (
                    <option key={club.clubId} value={club.clubId}>
                      {club.name}
                    </option>
                  ))}
                </Select>

                <Select
                  label="Venue"
                  required
                  placeholder="Select a venue"
                  error={errors.venueId?.message}
                  hint={
                    selectedVenue
                      ? `${selectedVenue.name} · ${selectedVenue.capacity} seats · ${selectedVenue.location}`
                      : venuesQuery.isError
                        ? 'Could not load venues.'
                        : undefined
                  }
                  disabled={venuesQuery.isLoading || venues.length === 0}
                  {...register('venueId')}
                >
                  {venues.map((venue) => (
                    <option key={venue.venueId} value={venue.venueId}>
                      {venue.name} ({venue.capacity} seats)
                    </option>
                  ))}
                </Select>
              </div>

              <Input
                label="Event title"
                required
                placeholder="e.g. Spring Robotics Showcase"
                error={errors.title?.message}
                {...register('title')}
              />

              <Textarea
                label="Description"
                placeholder="What will happen, who should come and what should they bring?"
                rows={5}
                error={errors.description?.message}
                hint={`${typeof watchedDescription === 'string' ? watchedDescription.length : 0} / 3000 characters`}
                {...register('description')}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Event date & time"
                  required
                  type="datetime-local"
                  error={errors.eventDate?.message}
                  {...register('eventDate')}
                />
                <Input
                  label="Registration deadline"
                  required
                  type="datetime-local"
                  error={errors.registrationDeadline?.message}
                  hint="Students cannot register after this moment."
                  {...register('registrationDeadline')}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Capacity"
                  required
                  type="number"
                  min={1}
                  max={selectedVenue?.capacity ?? 100000}
                  step={1}
                  error={errors.capacity?.message}
                  hint={
                    capacityOverVenue && selectedVenue
                      ? `${selectedVenue.name} only holds ${selectedVenue.capacity} people.`
                      : 'Seats available to students.'
                  }
                  {...register('capacity')}
                />
                <div className="rounded-xl border border-ink-100 bg-ink-50/60 px-4 py-3">
                  <p className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-ink-400">Venue limit</p>
                  <p className="mt-1 text-lg font-bold tracking-[-0.03em] text-ink-900">
                    {selectedVenue ? `${selectedVenue.capacity} seats` : '—'}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {capacityOverVenue
                      ? 'Reduce capacity to fit the venue.'
                      : 'Your capacity cannot exceed the venue limit.'}
                  </p>
                </div>
              </div>

              {clubsQuery.isSuccess && clubs.length === 0 ? (
                <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[0.8125rem] leading-relaxed text-amber-900">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    You do not coordinate any clubs yet. An administrator must assign you as a club coordinator
                    before you can create events.
                  </p>
                </div>
              ) : null}

              {venuesQuery.isSuccess && venues.length === 0 ? (
                <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[0.8125rem] leading-relaxed text-amber-900">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>No venues are available yet. An administrator needs to add a venue first.</p>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-100 pt-5">
                <Link to="/coordinator/events" className={buttonStyles({ variant: 'secondary' })}>
                  <X className="h-4 w-4" /> Cancel
                </Link>
                <Button
                  type="submit"
                  loading={saving || isSubmitting}
                  disabled={clubs.length === 0 || venues.length === 0}
                  leftIcon={<Save className="h-4 w-4" />}
                >
                  {isEdit ? 'Save changes' : 'Submit for approval'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <Card className="overflow-hidden">
            <div className="relative overflow-hidden bg-ink-950 px-5 py-4 text-white">
              <div className="surface-grid absolute inset-0 opacity-30" aria-hidden />
              <div className="absolute -right-8 -top-10 h-32 w-32 rounded-full bg-brand-500/30 blur-2xl" aria-hidden />
              <div className="relative">
                <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-white/50">Live preview</p>
                <p className="mt-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-acid-300">
                  {selectedClub ? selectedClub.name : 'Choose a club'}
                </p>
                <h3 className="mt-1 text-lg font-bold leading-snug text-white">{previewTitle}</h3>
              </div>
            </div>
            <CardContent className="space-y-3 pt-5">
              <p className="line-clamp-3 text-[0.8125rem] leading-relaxed text-ink-500">{previewDescription}</p>
              <div className="space-y-2 border-t border-ink-100 pt-3 text-xs text-ink-600">
                <p className="inline-flex items-center gap-2">
                  <CalendarDays className="h-3.5 w-3.5 text-ink-400" />
                  {hasPreviewDate
                    ? `${formatDate(watchedEventDate as string, 'EEE, d MMM yyyy')} · ${formatTime(watchedEventDate as string)}`
                    : 'Date not set'}
                </p>
                <p className="inline-flex items-center gap-2">
                  <Clock3 className="h-3.5 w-3.5 text-ink-400" />
                  {typeof watchedDeadline === 'string' && watchedDeadline
                    ? `Register by ${formatDate(watchedDeadline, 'd MMM, h:mm a')}`
                    : 'Deadline not set'}
                </p>
                <p className="inline-flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 text-ink-400" />
                  {selectedVenue ? `${selectedVenue.name} · ${selectedVenue.location}` : 'Venue not set'}
                </p>
                <p className="inline-flex items-center gap-2">
                  <Users className="h-3.5 w-3.5 text-ink-400" />
                  {Number.isFinite(watchedCapacity) && watchedCapacity > 0
                    ? `${watchedCapacity} seats`
                    : 'Capacity not set'}
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="rounded-2xl border border-ink-200/70 bg-white p-4 text-[0.8125rem] leading-relaxed text-ink-500 shadow-card">
            <p className="mb-1 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-ink-700">
              <Info className="h-3.5 w-3.5" /> Approval workflow
            </p>
            {isEdit
              ? 'Saving changes keeps the current status. Only an administrator can publish, reject, complete or cancel an event.'
              : 'New events are created as pending. An administrator reviews and publishes them before students can register.'}
          </div>
        </div>
      </div>
    </div>
  )
}
