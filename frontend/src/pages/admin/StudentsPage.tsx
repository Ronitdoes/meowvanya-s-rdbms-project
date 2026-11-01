import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { toast } from 'sonner'
import { GraduationCap, KeyRound, Mail, Pencil, Plus, UserCheck, UserRound, UserX } from 'lucide-react'
import { api, ApiError, errorMessage } from '@/services/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDate } from '@/lib/utils'
import type { Department, Student } from '@/types'
import { PageHeader, EmptyState, ErrorState, SearchInput } from '@/components/shared/PageChrome'
import { Avatar } from '@/components/shared/Avatar'
import { Pagination } from '@/components/shared/Pagination'
import { Card, CardFooter } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Skeleton'
import { TableWrapper, Table, THead, TBody, TR, TH, TD, TableEmpty } from '@/components/ui/Table'

const PAGE_SIZE = 10

const createStudentSchema = z.object({
  fullName: z.string().min(2, 'Enter the full name.').max(120, 'Name is too long.'),
  email: z.string().min(1, 'Email is required.').email('Enter a valid email address.'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .regex(/[A-Za-z]/, 'Include at least one letter.')
    .regex(/[0-9]/, 'Include at least one number.'),
  enrollmentNumber: z
    .string()
    .min(4, 'Enrollment number is too short.')
    .max(24, 'Enrollment number is too long.')
    .regex(/^[A-Za-z0-9-]+$/, 'Use letters, numbers or dashes only.'),
  departmentId: z.string().min(1, 'Select a department.'),
  role: z.enum(['student', 'coordinator']),
})

const editStudentSchema = z.object({
  fullName: z.string().min(2, 'Enter the full name.').max(120, 'Name is too long.'),
  enrollmentNumber: z
    .string()
    .min(4, 'Enrollment number is too short.')
    .max(24, 'Enrollment number is too long.')
    .regex(/^[A-Za-z0-9-]+$/, 'Use letters, numbers or dashes only.'),
  departmentId: z.string().min(1, 'Select a department.'),
})

type CreateStudentValues = z.infer<typeof createStudentSchema>
type EditStudentValues = z.infer<typeof editStudentSchema>

const createDefaults: CreateStudentValues = {
  fullName: '',
  email: '',
  password: '',
  enrollmentNumber: '',
  departmentId: '',
  role: 'student',
}

const editDefaults: EditStudentValues = { fullName: '', enrollmentNumber: '', departmentId: '' }

function useDebouncedValue<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export default function AdminStudentsPage() {
  usePageTitle('Students')
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [page, setPage] = useState(1)
  const debouncedSearch = useDebouncedValue(search)

  const [createOpen, setCreateOpen] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Student | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [deactivating, setDeactivating] = useState<Student | null>(null)

  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: () => api.get<Department[]>('/departments'),
    staleTime: 10 * 60 * 1000,
  })

  const students = useQuery({
    queryKey: ['admin-students', { search: debouncedSearch, departmentId, page }],
    queryFn: () =>
      api.list<Student>('/admin/students', {
        search: debouncedSearch.trim() || undefined,
        departmentId: departmentId ? Number(departmentId) : undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  })

  const createForm = useForm<CreateStudentValues>({
    resolver: zodResolver(createStudentSchema),
    defaultValues: createDefaults,
  })

  const editForm = useForm<EditStudentValues>({
    resolver: zodResolver(editStudentSchema),
    defaultValues: editDefaults,
  })

  const openEdit = (student: Student) => {
    editForm.reset({
      fullName: student.fullName,
      enrollmentNumber: student.enrollmentNumber,
      departmentId: String(student.departmentId),
    })
    setEditError(null)
    setEditing(student)
  }

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-students'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] })
    void queryClient.invalidateQueries({ queryKey: ['departments'] })
  }

  const createStudent = useMutation({
    mutationFn: (values: CreateStudentValues) =>
      api.post<Student>('/admin/students', {
        fullName: values.fullName.trim(),
        email: values.email.trim().toLowerCase(),
        password: values.password,
        enrollmentNumber: values.enrollmentNumber.trim().toUpperCase(),
        departmentId: Number(values.departmentId),
        role: values.role,
      }),
    onSuccess: () => {
      toast.success('Student account created')
      setCreateOpen(false)
      createForm.reset(createDefaults)
      setCreateError(null)
      setPage(1)
      invalidate()
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const [field, message] of Object.entries(error.fields)) {
          if (
            field === 'fullName' ||
            field === 'email' ||
            field === 'password' ||
            field === 'enrollmentNumber' ||
            field === 'departmentId' ||
            field === 'role'
          ) {
            createForm.setError(field, { type: 'server', message })
          }
        }
        setCreateError(error.message)
        return
      }
      setCreateError(errorMessage(error))
    },
  })

  const updateStudent = useMutation({
    mutationFn: ({ id, values }: { id: number; values: EditStudentValues }) =>
      api.patch<Student>(`/admin/students/${id}`, {
        fullName: values.fullName.trim(),
        enrollmentNumber: values.enrollmentNumber.trim().toUpperCase(),
        departmentId: Number(values.departmentId),
      }),
    onSuccess: () => {
      toast.success('Student profile updated')
      setEditing(null)
      setEditError(null)
      invalidate()
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const [field, message] of Object.entries(error.fields)) {
          if (field === 'fullName' || field === 'enrollmentNumber' || field === 'departmentId') {
            editForm.setError(field, { type: 'server', message })
          }
        }
        setEditError(error.message)
        return
      }
      setEditError(errorMessage(error))
    },
  })

  const toggleActive = useMutation({
    mutationFn: ({ userId, isActive }: { userId: number; isActive: boolean }) =>
      api.patch<unknown>(`/admin/users/${userId}`, { isActive }),
    onSuccess: (_, variables) => {
      toast.success(variables.isActive ? 'Student reactivated' : 'Student deactivated')
      setDeactivating(null)
      invalidate()
    },
    onError: (error) => {
      toast.error(errorMessage(error))
      setDeactivating(null)
    },
  })

  const openCreate = () => {
    setCreateError(null)
    createForm.reset(createDefaults)
    setCreateOpen(true)
  }

  const submitCreate = (values: CreateStudentValues) => {
    setCreateError(null)
    createStudent.mutate(values)
  }

  const submitEdit = (values: EditStudentValues) => {
    if (!editing) return
    setEditError(null)
    updateStudent.mutate({ id: editing.studentId, values })
  }

  const total = students.data?.meta.total

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Admin console"
        title="Students"
        description="Search the student directory, keep profiles accurate and manage account access."
        actions={
          <Button onClick={openCreate} leftIcon={<Plus className="h-4 w-4" />}>
            Add student
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
          placeholder="Search by name, email or enrollment…"
          className="sm:max-w-md"
        />
        <div className="flex items-center gap-3">
          <Select
            aria-label="Filter by department"
            value={departmentId}
            onChange={(event) => {
              setDepartmentId(event.target.value)
              setPage(1)
            }}
            className="h-10 min-w-48"
          >
            <option value="">All departments</option>
            {(departments.data ?? []).map((department) => (
              <option key={department.departmentId} value={department.departmentId}>
                {department.name}
              </option>
            ))}
          </Select>
          {typeof total === 'number' ? (
            <span className="hidden whitespace-nowrap text-xs font-semibold text-ink-400 sm:block">
              {total} {total === 1 ? 'student' : 'students'}
            </span>
          ) : null}
        </div>
      </div>

      {students.isError ? (
        <ErrorState
          title="Students could not be loaded"
          message={errorMessage(students.error)}
          onRetry={() => void students.refetch()}
        />
      ) : (
        <Card>
          <TableWrapper>
            <Table>
              <THead>
                <TR>
                  <TH className="pl-6">Student</TH>
                  <TH>Enrollment</TH>
                  <TH>Department</TH>
                  <TH>Status</TH>
                  <TH>Joined</TH>
                  <TH className="pr-6 text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {students.isLoading ? (
                  <TableEmpty colSpan={6}>
                    <span className="inline-flex items-center gap-2">
                      <Spinner className="h-4 w-4" /> Loading students…
                    </span>
                  </TableEmpty>
                ) : students.data && students.data.data.length > 0 ? (
                  students.data.data.map((student) => (
                    <TR key={student.studentId}>
                      <TD className="pl-6">
                        <div className="flex min-w-48 items-center gap-3">
                          <Avatar name={student.fullName} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-ink-900">{student.fullName}</p>
                            <p className="truncate text-xs text-ink-400">{student.email}</p>
                          </div>
                        </div>
                      </TD>
                      <TD>
                        <span className="rounded-lg bg-ink-50 px-2 py-1 font-mono text-[0.6875rem] font-semibold text-ink-600">
                          {student.enrollmentNumber}
                        </span>
                      </TD>
                      <TD className="whitespace-nowrap text-sm">{student.departmentName}</TD>
                      <TD>
                        <Badge tone={student.isActive ? 'success' : 'danger'} dot>
                          {student.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TD>
                      <TD className="whitespace-nowrap text-xs text-ink-500">{formatDate(student.createdAt)}</TD>
                      <TD className="pr-6">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEdit(student)}
                            aria-label={`Edit ${student.fullName}`}
                            title="Edit student"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {student.isActive ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                              onClick={() => setDeactivating(student)}
                              aria-label={`Deactivate ${student.fullName}`}
                              title="Deactivate student"
                            >
                              <UserX className="h-3.5 w-3.5" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-brand-700 hover:bg-brand-50 hover:text-brand-800"
                              onClick={() => toggleActive.mutate({ userId: student.userId, isActive: true })}
                              aria-label={`Reactivate ${student.fullName}`}
                              title="Reactivate student"
                            >
                              <UserCheck className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TD>
                    </TR>
                  ))
                ) : (
                  <TableEmpty colSpan={6}>
                    <div className="flex justify-center">
                      <EmptyState
                        className="py-10"
                        icon={<GraduationCap className="h-6 w-6" />}
                        title={search || departmentId ? 'No students match these filters' : 'No students yet'}
                        description={
                          search || departmentId
                            ? 'Try a different search term or department.'
                            : 'Add the first student account to start building the directory.'
                        }
                        action={
                          !search && !departmentId ? (
                            <Button size="sm" onClick={openCreate} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                              Add student
                            </Button>
                          ) : undefined
                        }
                      />
                    </div>
                  </TableEmpty>
                )}
              </TBody>
            </Table>
          </TableWrapper>
          <CardFooter className="justify-between">
            <Pagination meta={students.data?.meta} onPageChange={setPage} label="students" />
          </CardFooter>
        </Card>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add a student"
        description="Create the account and student profile in one step."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={createStudent.isPending}>
              Cancel
            </Button>
            <Button type="submit" form="create-student-form" loading={createStudent.isPending}>
              Create student
            </Button>
          </>
        }
      >
        <form id="create-student-form" onSubmit={createForm.handleSubmit(submitCreate)} className="space-y-4" noValidate>
          {createError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
              {createError}
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Full name"
              placeholder="Aarav Sharma"
              leftIcon={<UserRound className="h-4 w-4" />}
              error={createForm.formState.errors.fullName?.message}
              {...createForm.register('fullName')}
            />
            <Input
              label="College email"
              type="email"
              autoComplete="off"
              placeholder="student@college.edu"
              leftIcon={<Mail className="h-4 w-4" />}
              error={createForm.formState.errors.email?.message}
              {...createForm.register('email')}
            />
            <Input
              label="Enrollment number"
              placeholder="CSE2026001"
              className="uppercase"
              error={createForm.formState.errors.enrollmentNumber?.message}
              {...createForm.register('enrollmentNumber')}
            />
            <Select
              label="Department"
              error={createForm.formState.errors.departmentId?.message}
              placeholder={departments.isLoading ? 'Loading departments…' : 'Select department'}
              disabled={departments.isLoading}
              {...createForm.register('departmentId')}
            >
              {(departments.data ?? []).map((department) => (
                <option key={department.departmentId} value={department.departmentId}>
                  {department.name} ({department.code})
                </option>
              ))}
            </Select>
            <Select label="Account role" error={createForm.formState.errors.role?.message} {...createForm.register('role')}>
              <option value="student">Student</option>
              <option value="coordinator">Coordinator</option>
            </Select>
            <Input
              label="Temporary password"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              hint="At least 8 characters, one letter and one number."
              leftIcon={<KeyRound className="h-4 w-4" />}
              error={createForm.formState.errors.password?.message}
              {...createForm.register('password')}
            />
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Edit student"
        description={editing ? `Update the profile for ${editing.fullName}.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={updateStudent.isPending}>
              Cancel
            </Button>
            <Button type="submit" form="edit-student-form" loading={updateStudent.isPending}>
              Save changes
            </Button>
          </>
        }
      >
        <form id="edit-student-form" onSubmit={editForm.handleSubmit(submitEdit)} className="space-y-4" noValidate>
          {editError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
              {editError}
            </div>
          ) : null}
          <Input
            label="Full name"
            leftIcon={<UserRound className="h-4 w-4" />}
            error={editForm.formState.errors.fullName?.message}
            {...editForm.register('fullName')}
          />
          <Input
            label="Enrollment number"
            className="uppercase"
            error={editForm.formState.errors.enrollmentNumber?.message}
            {...editForm.register('enrollmentNumber')}
          />
          <Select
            label="Department"
            error={editForm.formState.errors.departmentId?.message}
            disabled={departments.isLoading}
            {...editForm.register('departmentId')}
          >
            <option value="">{departments.isLoading ? 'Loading…' : 'Select department'}</option>
            {(departments.data ?? []).map((department) => (
              <option key={department.departmentId} value={department.departmentId}>
                {department.name} ({department.code})
              </option>
            ))}
          </Select>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deactivating)}
        onClose={() => setDeactivating(null)}
        onConfirm={() => {
          if (deactivating) toggleActive.mutate({ userId: deactivating.userId, isActive: false })
        }}
        title="Deactivate student?"
        description={
          deactivating
            ? `${deactivating.fullName} will no longer be able to sign in or register for events. Their history stays intact and the account can be reactivated later.`
            : undefined
        }
        confirmLabel="Deactivate"
        tone="danger"
        loading={toggleActive.isPending}
      />
    </div>
  )
}
