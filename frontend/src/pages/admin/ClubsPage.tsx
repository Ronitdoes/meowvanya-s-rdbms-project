import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { toast } from 'sonner'
import { Check, Crown, Pencil, Plus, Trash2, Users, X } from 'lucide-react'
import { api, ApiError, errorMessage } from '@/services/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import { cn } from '@/lib/utils'
import type { Club, Student } from '@/types'
import { PageHeader, ErrorState, SearchInput } from '@/components/shared/PageChrome'
import { ClubCard } from '@/components/shared/ClubCard'
import { Avatar } from '@/components/shared/Avatar'
import { Pagination } from '@/components/shared/Pagination'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Skeleton'

const PAGE_SIZE = 9

const clubSchema = z.object({
  name: z.string().min(2, 'Give the club a name.').max(120, 'Name is too long.'),
  description: z.string().max(3000, 'Description is too long.'),
  status: z.enum(['pending', 'approved', 'rejected', 'inactive']),
})

type ClubFormValues = z.infer<typeof clubSchema>

const clubDefaults: ClubFormValues = { name: '', description: '', status: 'pending' }

function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export default function AdminClubsPage() {
  usePageTitle('Clubs')
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const debouncedSearch = useDebouncedValue(search)

  const [createOpen, setCreateOpen] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Club | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<Club | null>(null)
  const [deleting, setDeleting] = useState<Club | null>(null)

  const [coordinatorClub, setCoordinatorClub] = useState<Club | null>(null)
  const [studentSearch, setStudentSearch] = useState('')
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null)
  const debouncedStudentSearch = useDebouncedValue(studentSearch)

  const clubs = useQuery({
    queryKey: ['admin-clubs', { search: debouncedSearch, status, page }],
    queryFn: () =>
      api.list<Club>('/admin/clubs', {
        search: debouncedSearch.trim() || undefined,
        status: status || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  })

  const coordinatorStudents = useQuery({
    queryKey: ['admin-students', 'coordinator-picker', debouncedStudentSearch],
    queryFn: () =>
      api.list<Student>('/admin/students', {
        search: debouncedStudentSearch.trim() || undefined,
        page: 1,
        pageSize: 100,
      }),
    enabled: Boolean(coordinatorClub),
    placeholderData: keepPreviousData,
  })

  const createForm = useForm<ClubFormValues>({
    resolver: zodResolver(clubSchema),
    defaultValues: clubDefaults,
  })

  const editForm = useForm<ClubFormValues>({
    resolver: zodResolver(clubSchema),
    defaultValues: clubDefaults,
  })

  const openEdit = (club: Club) => {
    editForm.reset({
      name: club.name,
      description: club.description,
      status: club.status,
    })
    setEditError(null)
    setEditing(club)
  }

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-clubs'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] })
  }

  const createClub = useMutation({
    mutationFn: (values: ClubFormValues) =>
      api.post<Club>('/admin/clubs', {
        name: values.name.trim(),
        description: values.description.trim(),
        status: values.status,
      }),
    onSuccess: () => {
      toast.success('Club created')
      setCreateOpen(false)
      createForm.reset(clubDefaults)
      setCreateError(null)
      setPage(1)
      invalidate()
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const [field, message] of Object.entries(error.fields)) {
          if (field === 'name' || field === 'description' || field === 'status') {
            createForm.setError(field, { type: 'server', message })
          }
        }
        setCreateError(error.message)
        return
      }
      setCreateError(errorMessage(error))
    },
  })

  const updateClub = useMutation({
    mutationFn: ({ id, values }: { id: number; values: ClubFormValues }) =>
      api.patch<Club>(`/admin/clubs/${id}`, {
        name: values.name.trim(),
        description: values.description.trim(),
        status: values.status,
      }),
    onSuccess: () => {
      toast.success('Club updated')
      setEditing(null)
      setEditError(null)
      invalidate()
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const [field, message] of Object.entries(error.fields)) {
          if (field === 'name' || field === 'description' || field === 'status') {
            editForm.setError(field, { type: 'server', message })
          }
        }
        setEditError(error.message)
        return
      }
      setEditError(errorMessage(error))
    },
  })

  const setClubStatus = useMutation({
    mutationFn: ({ id, nextStatus }: { id: number; nextStatus: Club['status'] }) =>
      api.patch<Club>(`/admin/clubs/${id}`, { status: nextStatus }),
    onSuccess: (_, variables) => {
      const copy =
        variables.nextStatus === 'approved'
          ? 'Club approved'
          : variables.nextStatus === 'rejected'
            ? 'Club rejected'
            : 'Club status updated'
      toast.success(copy)
      setRejecting(null)
      invalidate()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const assignCoordinator = useMutation({
    mutationFn: ({ clubId, studentId }: { clubId: number; studentId: number }) =>
      api.post<Club>(`/admin/clubs/${clubId}/coordinator`, { studentId }),
    onSuccess: () => {
      toast.success('Coordinator assigned')
      setCoordinatorClub(null)
      setSelectedStudentId(null)
      setStudentSearch('')
      invalidate()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const deleteClub = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/clubs/${id}`),
    onSuccess: () => {
      toast.success('Club deleted')
      setDeleting(null)
      invalidate()
    },
    onError: (error) => {
      toast.error(errorMessage(error))
      setDeleting(null)
    },
  })

  const openCreate = () => {
    setCreateError(null)
    createForm.reset(clubDefaults)
    setCreateOpen(true)
  }

  const openCoordinator = (club: Club) => {
    setSelectedStudentId(null)
    setStudentSearch('')
    setCoordinatorClub(club)
  }

  const submitCreate = (values: ClubFormValues) => {
    setCreateError(null)
    createClub.mutate(values)
  }

  const submitEdit = (values: ClubFormValues) => {
    if (!editing) return
    setEditError(null)
    updateClub.mutate({ id: editing.clubId, values })
  }

  const total = clubs.data?.meta.total

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Admin console"
        title="Clubs"
        description="Approve new organisations, keep profiles current and make sure every club has a coordinator."
        actions={
          <Button onClick={openCreate} leftIcon={<Plus className="h-4 w-4" />}>
            New club
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          placeholder="Search clubs by name…"
          className="sm:max-w-md"
        />
        <div className="flex items-center gap-3">
          <Select
            aria-label="Filter by club status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value)
              setPage(1)
            }}
            className="h-10 min-w-40"
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="inactive">Inactive</option>
          </Select>
          {typeof total === 'number' ? (
            <span className="hidden whitespace-nowrap text-xs font-semibold text-ink-400 sm:block">
              {total} {total === 1 ? 'club' : 'clubs'}
            </span>
          ) : null}
        </div>
      </div>

      {clubs.isError ? (
        <ErrorState title="Clubs could not be loaded" message={errorMessage(clubs.error)} onRetry={() => void clubs.refetch()} />
      ) : clubs.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-64 rounded-3xl" />
          ))}
        </div>
      ) : clubs.data && clubs.data.data.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {clubs.data.data.map((club) => (
            <ClubCard
              key={club.clubId}
              club={club}
              showStatus
              actions={
                <div className="flex w-full flex-wrap items-center gap-1.5">
                  {club.status === 'pending' ? (
                    <>
                      <Button
                        size="sm"
                        onClick={() => setClubStatus.mutate({ id: club.clubId, nextStatus: 'approved' })}
                        disabled={setClubStatus.isPending}
                        leftIcon={<Check className="h-3.5 w-3.5" />}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setRejecting(club)}
                        disabled={setClubStatus.isPending}
                        leftIcon={<X className="h-3.5 w-3.5" />}
                      >
                        Reject
                      </Button>
                    </>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => openEdit(club)}
                    aria-label={`Edit ${club.name}`}
                    title="Edit club"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => openCoordinator(club)}
                    aria-label={`Assign a coordinator for ${club.name}`}
                    title="Assign coordinator"
                  >
                    <Crown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                    onClick={() => setDeleting(club)}
                    aria-label={`Delete ${club.name}`}
                    title="Delete club"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              }
            />
          ))}
        </div>
      ) : (
        <Card>
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-ink-100 text-ink-400">
              <Users className="h-6 w-6" />
            </div>
            <h3 className="text-base font-bold text-ink-900">
              {search || status ? 'No clubs match these filters' : 'No clubs yet'}
            </h3>
            <p className="mt-1 max-w-sm text-sm leading-relaxed text-ink-500">
              {search || status
                ? 'Try a different search term or status.'
                : 'Create the first club and invite students to join.'}
            </p>
            {!search && !status ? (
              <Button size="sm" className="mt-5" onClick={openCreate} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                New club
              </Button>
            ) : null}
          </div>
        </Card>
      )}

      <Pagination meta={clubs.data?.meta} onPageChange={setPage} label="clubs" />

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create a club"
        description="Clubs start as pending until an administrator approves them."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={createClub.isPending}>
              Cancel
            </Button>
            <Button type="submit" form="create-club-form" loading={createClub.isPending}>
              Create club
            </Button>
          </>
        }
      >
        <form id="create-club-form" onSubmit={createForm.handleSubmit(submitCreate)} className="space-y-4" noValidate>
          {createError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
              {createError}
            </div>
          ) : null}
          <Input label="Club name" placeholder="Robotics Society" error={createForm.formState.errors.name?.message} {...createForm.register('name')} />
          <Textarea
            label="Description"
            rows={4}
            placeholder="What does this club do, and who should join?"
            error={createForm.formState.errors.description?.message}
            {...createForm.register('description')}
          />
          <Select label="Status" error={createForm.formState.errors.status?.message} {...createForm.register('status')}>
            <option value="pending">Pending review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="inactive">Inactive</option>
          </Select>
        </form>
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Edit club"
        description={editing ? `Update the profile and status for ${editing.name}.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={updateClub.isPending}>
              Cancel
            </Button>
            <Button type="submit" form="edit-club-form" loading={updateClub.isPending}>
              Save changes
            </Button>
          </>
        }
      >
        <form id="edit-club-form" onSubmit={editForm.handleSubmit(submitEdit)} className="space-y-4" noValidate>
          {editError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
              {editError}
            </div>
          ) : null}
          <Input label="Club name" error={editForm.formState.errors.name?.message} {...editForm.register('name')} />
          <Textarea
            label="Description"
            rows={4}
            error={editForm.formState.errors.description?.message}
            {...editForm.register('description')}
          />
          <Select label="Status" error={editForm.formState.errors.status?.message} {...editForm.register('status')}>
            <option value="pending">Pending review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="inactive">Inactive</option>
          </Select>
        </form>
      </Modal>

      <Modal
        open={Boolean(coordinatorClub)}
        onClose={() => setCoordinatorClub(null)}
        title="Assign coordinator"
        description={coordinatorClub ? `Choose the student who will run ${coordinatorClub.name}.` : undefined}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCoordinatorClub(null)} disabled={assignCoordinator.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (coordinatorClub && selectedStudentId) {
                  assignCoordinator.mutate({ clubId: coordinatorClub.clubId, studentId: selectedStudentId })
                }
              }}
              disabled={!selectedStudentId}
              loading={assignCoordinator.isPending}
            >
              Assign coordinator
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {coordinatorClub?.coordinatorName ? (
            <div className="rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3">
              <p className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-brand-700">Current coordinator</p>
              <p className="mt-1 text-sm font-semibold text-ink-900">{coordinatorClub.coordinatorName}</p>
              {coordinatorClub.coordinatorEmail ? (
                <p className="text-xs text-ink-500">{coordinatorClub.coordinatorEmail}</p>
              ) : null}
            </div>
          ) : null}
          <SearchInput
            value={studentSearch}
            onChange={setStudentSearch}
            placeholder="Search students by name, email or enrollment…"
          />
          <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
            {coordinatorStudents.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-16 rounded-2xl" />
                <Skeleton className="h-16 rounded-2xl" />
                <Skeleton className="h-16 rounded-2xl" />
              </div>
            ) : coordinatorStudents.isError ? (
              <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {errorMessage(coordinatorStudents.error)}
              </p>
            ) : coordinatorStudents.data && coordinatorStudents.data.data.length > 0 ? (
              coordinatorStudents.data.data.map((student) => {
                const selected = selectedStudentId === student.studentId
                return (
                  <button
                    key={student.studentId}
                    type="button"
                    onClick={() => setSelectedStudentId(student.studentId)}
                    aria-pressed={selected}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors',
                      selected ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500/20' : 'border-ink-100 hover:border-ink-200 hover:bg-ink-50',
                    )}
                  >
                    <Avatar name={student.fullName} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink-900">{student.fullName}</span>
                      <span className="block truncate text-xs text-ink-400">
                        {student.email} · {student.enrollmentNumber} · {student.departmentName}
                      </span>
                    </span>
                    {selected ? <Check className="h-4 w-4 shrink-0 text-brand-700" /> : null}
                  </button>
                )
              })
            ) : (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-200 px-6 py-10 text-center">
                <Users className="h-6 w-6 text-ink-300" />
                <p className="mt-3 text-sm font-semibold text-ink-700">No students found</p>
                <p className="mt-1 text-xs text-ink-400">Try a different search term.</p>
              </div>
            )}
          </div>
          <p className="text-xs leading-relaxed text-ink-400">
            Assigning a coordinator grants them management access to this club and its events.
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        onConfirm={() => {
          if (rejecting) setClubStatus.mutate({ id: rejecting.clubId, nextStatus: 'rejected' })
        }}
        title="Reject this club?"
        description={
          rejecting
            ? `${rejecting.name} will not be visible to students. You can approve it later from the club list.`
            : undefined
        }
        confirmLabel="Reject club"
        tone="danger"
        loading={setClubStatus.isPending}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) deleteClub.mutate(deleting.clubId)
        }}
        title="Delete this club?"
        description={
          deleting
            ? `${deleting.name} will be permanently removed. Clubs with existing events cannot be deleted.`
            : undefined
        }
        confirmLabel="Delete club"
        tone="danger"
        loading={deleteClub.isPending}
      />
    </div>
  )
}
