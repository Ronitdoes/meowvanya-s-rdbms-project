import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { toast } from 'sonner'
import { CalendarDays, MapPin, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { api, ApiError, errorMessage } from '@/services/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDate } from '@/lib/utils'
import type { Venue } from '@/types'
import { PageHeader, EmptyState, ErrorState } from '@/components/shared/PageChrome'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Skeleton'

const venueSchema = z.object({
  name: z.string().min(2, 'Give the venue a name.').max(120, 'Name is too long.'),
  capacity: z
    .string()
    .min(1, 'Enter a capacity.')
    .refine((value) => {
      const parsed = Number(value)
      return Number.isInteger(parsed) && parsed > 0
    }, 'Capacity must be a whole number greater than zero.')
    .refine((value) => Number(value) <= 100000, 'Capacity looks too large.'),
  location: z.string().min(2, 'Give the venue a location.').max(160, 'Location is too long.'),
})

type VenueFormValues = z.infer<typeof venueSchema>

const venueDefaults: VenueFormValues = { name: '', capacity: '', location: '' }

export default function AdminVenuesPage() {
  usePageTitle('Venues')
  const queryClient = useQueryClient()

  const [createOpen, setCreateOpen] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Venue | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Venue | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const venues = useQuery({
    queryKey: ['venues'],
    queryFn: () => api.get<Venue[]>('/venues'),
  })

  const createForm = useForm<VenueFormValues>({
    resolver: zodResolver(venueSchema),
    defaultValues: venueDefaults,
  })

  const editForm = useForm<VenueFormValues>({
    resolver: zodResolver(venueSchema),
    defaultValues: venueDefaults,
  })

  useEffect(() => {
    if (editing) {
      editForm.reset({
        name: editing.name,
        capacity: String(editing.capacity),
        location: editing.location,
      })
      setEditError(null)
    }
  }, [editing, editForm])

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['venues'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] })
  }

  const createVenue = useMutation({
    mutationFn: (values: VenueFormValues) =>
      api.post<Venue>('/admin/venues', {
        name: values.name.trim(),
        capacity: Number(values.capacity),
        location: values.location.trim(),
      }),
    onSuccess: () => {
      toast.success('Venue added')
      setCreateOpen(false)
      createForm.reset(venueDefaults)
      setCreateError(null)
      invalidate()
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const [field, message] of Object.entries(error.fields)) {
          if (field === 'name' || field === 'capacity' || field === 'location') {
            createForm.setError(field, { type: 'server', message })
          }
        }
        setCreateError(error.message)
        return
      }
      setCreateError(errorMessage(error))
    },
  })

  const updateVenue = useMutation({
    mutationFn: ({ id, values }: { id: number; values: VenueFormValues }) =>
      api.patch<Venue>(`/admin/venues/${id}`, {
        name: values.name.trim(),
        capacity: Number(values.capacity),
        location: values.location.trim(),
      }),
    onSuccess: () => {
      toast.success('Venue updated')
      setEditing(null)
      setEditError(null)
      invalidate()
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const [field, message] of Object.entries(error.fields)) {
          if (field === 'name' || field === 'capacity' || field === 'location') {
            editForm.setError(field, { type: 'server', message })
          }
        }
        setEditError(error.message)
        return
      }
      setEditError(errorMessage(error))
    },
  })

  const deleteVenue = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/venues/${id}`),
    onSuccess: () => {
      toast.success('Venue deleted')
      setDeleting(null)
      setDeleteError(null)
      invalidate()
    },
    onError: (error) => setDeleteError(errorMessage(error)),
  })

  const openDelete = (venue: Venue) => {
    setDeleteError(null)
    setDeleting(venue)
  }

  const closeDelete = () => {
    setDeleting(null)
    setDeleteError(null)
  }

  const openCreate = () => {
    setCreateError(null)
    createForm.reset(venueDefaults)
    setCreateOpen(true)
  }

  const submitCreate = (values: VenueFormValues) => {
    setCreateError(null)
    createVenue.mutate(values)
  }

  const submitEdit = (values: VenueFormValues) => {
    if (!editing) return
    setEditError(null)
    updateVenue.mutate({ id: editing.venueId, values })
  }

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Admin console"
        title="Venues"
        description="Keep the campus venue directory accurate so clubs can book the right space for every event."
        actions={
          <Button onClick={openCreate} leftIcon={<Plus className="h-4 w-4" />}>
            Add venue
          </Button>
        }
      />

      {venues.isError ? (
        <ErrorState title="Venues could not be loaded" message={errorMessage(venues.error)} onRetry={() => void venues.refetch()} />
      ) : venues.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-56 rounded-3xl" />
          ))}
        </div>
      ) : venues.data && venues.data.length > 0 ? (
        <>
          <p className="text-xs font-semibold text-ink-400">
            {venues.data.length} {venues.data.length === 1 ? 'venue' : 'venues'} available
          </p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {venues.data.map((venue) => (
              <Card key={venue.venueId} className="flex h-full flex-col p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ink-950 text-acid-300">
                    <MapPin className="h-5 w-5" />
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setEditing(venue)}
                      aria-label={`Edit ${venue.name}`}
                      title="Edit venue"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                      onClick={() => openDelete(venue)}
                      aria-label={`Delete ${venue.name}`}
                      title="Delete venue"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="mt-4 flex-1">
                  <h3 className="text-base font-bold tracking-[-0.02em] text-ink-950">{venue.name}</h3>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-500">
                    <MapPin className="h-3.5 w-3.5 text-ink-400" /> {venue.location}
                  </p>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-2xl bg-ink-50 px-3 py-2.5">
                    <p className="flex items-center gap-1 text-[0.625rem] font-bold uppercase tracking-[0.1em] text-ink-400">
                      <Users className="h-3 w-3" /> Capacity
                    </p>
                    <p className="mt-1 text-lg font-bold tracking-[-0.03em] text-ink-900">{venue.capacity}</p>
                  </div>
                  <div className="rounded-2xl bg-ink-50 px-3 py-2.5">
                    <p className="flex items-center gap-1 text-[0.625rem] font-bold uppercase tracking-[0.1em] text-ink-400">
                      <CalendarDays className="h-3 w-3" /> Events
                    </p>
                    <p className="mt-1 text-lg font-bold tracking-[-0.03em] text-ink-900">{venue.eventCount}</p>
                  </div>
                </div>

                <p className="mt-4 text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-ink-300">
                  Added {formatDate(venue.createdAt)}
                </p>
              </Card>
            ))}
          </div>
        </>
      ) : (
        <Card>
          <EmptyState
            icon={<MapPin className="h-6 w-6" />}
            title="No venues yet"
            description="Add the first bookable space so clubs can start planning events."
            action={
              <Button size="sm" onClick={openCreate} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                Add venue
              </Button>
            }
          />
        </Card>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add a venue"
        description="Venues are shared across every club on campus."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={createVenue.isPending}>
              Cancel
            </Button>
            <Button type="submit" form="create-venue-form" loading={createVenue.isPending}>
              Add venue
            </Button>
          </>
        }
      >
        <form id="create-venue-form" onSubmit={createForm.handleSubmit(submitCreate)} className="space-y-4" noValidate>
          {createError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
              {createError}
            </div>
          ) : null}
          <Input label="Venue name" placeholder="Main Auditorium" error={createForm.formState.errors.name?.message} {...createForm.register('name')} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Capacity"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              placeholder="250"
              leftIcon={<Users className="h-4 w-4" />}
              error={createForm.formState.errors.capacity?.message}
              {...createForm.register('capacity')}
            />
            <Input
              label="Location"
              placeholder="Block A, ground floor"
              leftIcon={<MapPin className="h-4 w-4" />}
              error={createForm.formState.errors.location?.message}
              {...createForm.register('location')}
            />
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Edit venue"
        description={editing ? `Update the details for ${editing.name}.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={updateVenue.isPending}>
              Cancel
            </Button>
            <Button type="submit" form="edit-venue-form" loading={updateVenue.isPending}>
              Save changes
            </Button>
          </>
        }
      >
        <form id="edit-venue-form" onSubmit={editForm.handleSubmit(submitEdit)} className="space-y-4" noValidate>
          {editError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
              {editError}
            </div>
          ) : null}
          <Input label="Venue name" error={editForm.formState.errors.name?.message} {...editForm.register('name')} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Capacity"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              leftIcon={<Users className="h-4 w-4" />}
              error={editForm.formState.errors.capacity?.message}
              {...editForm.register('capacity')}
            />
            <Input
              label="Location"
              leftIcon={<MapPin className="h-4 w-4" />}
              error={editForm.formState.errors.location?.message}
              {...editForm.register('location')}
            />
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={closeDelete}
        onConfirm={() => {
          if (deleting) deleteVenue.mutate(deleting.venueId)
        }}
        title="Delete this venue?"
        description={
          deleting
            ? deleteError ??
              `${deleting.name} will be permanently removed. Venues with existing events cannot be deleted.`
            : undefined
        }
        confirmLabel="Delete venue"
        tone="danger"
        loading={deleteVenue.isPending}
      />
    </div>
  )
}
