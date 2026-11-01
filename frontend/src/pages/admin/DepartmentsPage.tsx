import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { toast } from 'sonner'
import { Building2, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { api, ApiError, errorMessage } from '@/services/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDate } from '@/lib/utils'
import type { Department } from '@/types'
import { PageHeader, EmptyState, ErrorState, SearchInput } from '@/components/shared/PageChrome'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Skeleton'
import { TableWrapper, Table, THead, TBody, TR, TH, TD, TableEmpty } from '@/components/ui/Table'

const departmentSchema = z.object({
  name: z.string().trim().min(2, 'Give the department a name.').max(120, 'Name is too long.'),
  code: z
    .string()
    .trim()
    .min(2, 'Use at least 2 letters.')
    .max(8, 'Use at most 8 letters.')
    .regex(/^[A-Za-z]+$/, 'Use letters A–Z only.'),
})

type DepartmentFormValues = z.infer<typeof departmentSchema>

const departmentDefaults: DepartmentFormValues = { name: '', code: '' }

export default function AdminDepartmentsPage() {
  usePageTitle('Departments')
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Department | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Department | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: () => api.get<Department[]>('/departments'),
    staleTime: 10 * 60 * 1000,
  })

  const createForm = useForm<DepartmentFormValues>({
    resolver: zodResolver(departmentSchema),
    defaultValues: departmentDefaults,
  })

  const editForm = useForm<DepartmentFormValues>({
    resolver: zodResolver(departmentSchema),
    defaultValues: departmentDefaults,
  })

  useEffect(() => {
    if (editing) {
      editForm.reset({ name: editing.name, code: editing.code })
      setEditError(null)
    }
  }, [editing, editForm])

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['departments'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-students'] })
  }

  const createDepartment = useMutation({
    mutationFn: (values: DepartmentFormValues) =>
      api.post<Department>('/admin/departments', {
        name: values.name.trim(),
        code: values.code.trim().toUpperCase(),
      }),
    onSuccess: () => {
      toast.success('Department created')
      setCreateOpen(false)
      createForm.reset(departmentDefaults)
      setCreateError(null)
      invalidate()
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const [field, message] of Object.entries(error.fields)) {
          if (field === 'name' || field === 'code') {
            createForm.setError(field, { type: 'server', message })
          }
        }
        setCreateError(error.message)
        return
      }
      setCreateError(errorMessage(error))
    },
  })

  const updateDepartment = useMutation({
    mutationFn: ({ id, values }: { id: number; values: DepartmentFormValues }) =>
      api.patch<Department>(`/admin/departments/${id}`, {
        name: values.name.trim(),
        code: values.code.trim().toUpperCase(),
      }),
    onSuccess: () => {
      toast.success('Department updated')
      setEditing(null)
      setEditError(null)
      invalidate()
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const [field, message] of Object.entries(error.fields)) {
          if (field === 'name' || field === 'code') {
            editForm.setError(field, { type: 'server', message })
          }
        }
        setEditError(error.message)
        return
      }
      setEditError(errorMessage(error))
    },
  })

  const deleteDepartment = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/departments/${id}`),
    onSuccess: () => {
      toast.success('Department deleted')
      setDeleting(null)
      setDeleteError(null)
      invalidate()
    },
    onError: (error) => setDeleteError(errorMessage(error)),
  })

  const openCreate = () => {
    setCreateError(null)
    createForm.reset(departmentDefaults)
    setCreateOpen(true)
  }

  const openDelete = (department: Department) => {
    setDeleteError(null)
    setDeleting(department)
  }

  const closeDelete = () => {
    setDeleting(null)
    setDeleteError(null)
  }

  const submitCreate = (values: DepartmentFormValues) => {
    setCreateError(null)
    createDepartment.mutate(values)
  }

  const submitEdit = (values: DepartmentFormValues) => {
    if (!editing) return
    setEditError(null)
    updateDepartment.mutate({ id: editing.departmentId, values })
  }

  const allDepartments = departments.data ?? []
  const query = search.trim().toLowerCase()
  const filtered = query
    ? allDepartments.filter(
        (department) =>
          department.name.toLowerCase().includes(query) || department.code.toLowerCase().includes(query),
      )
    : allDepartments
  const totalStudents = allDepartments.reduce((sum, department) => sum + department.studentCount, 0)

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Admin console"
        title="Departments"
        description="Keep the academic directory tidy so students, clubs and events are grouped correctly."
        actions={
          <Button onClick={openCreate} leftIcon={<Plus className="h-4 w-4" />}>
            Add department
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search by department name or code…"
          className="sm:max-w-md"
        />
        <span className="text-xs font-semibold text-ink-400">
          {filtered.length} {filtered.length === 1 ? 'department' : 'departments'} · {totalStudents}{' '}
          {totalStudents === 1 ? 'student' : 'students'}
        </span>
      </div>

      {departments.isError ? (
        <ErrorState
          title="Departments could not be loaded"
          message={errorMessage(departments.error)}
          onRetry={() => void departments.refetch()}
        />
      ) : (
        <Card>
          <TableWrapper>
            <Table>
              <THead>
                <TR>
                  <TH className="pl-6">Department</TH>
                  <TH>Code</TH>
                  <TH>Students</TH>
                  <TH>Added</TH>
                  <TH className="pr-6 text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {departments.isLoading ? (
                  <TableEmpty colSpan={5}>
                    <span className="inline-flex items-center gap-2">
                      <Spinner className="h-4 w-4" /> Loading departments…
                    </span>
                  </TableEmpty>
                ) : filtered.length > 0 ? (
                  filtered.map((department) => (
                    <TR key={department.departmentId}>
                      <TD className="pl-6">
                        <div className="flex min-w-48 items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                            <Building2 className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-ink-900">{department.name}</p>
                            <p className="truncate text-xs text-ink-400">Academic department</p>
                          </div>
                        </div>
                      </TD>
                      <TD>
                        <span className="rounded-lg bg-ink-50 px-2 py-1 font-mono text-[0.6875rem] font-semibold text-ink-600">
                          {department.code}
                        </span>
                      </TD>
                      <TD>
                        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-800">
                          <Users className="h-3.5 w-3.5 text-ink-400" />
                          {department.studentCount}
                        </span>
                      </TD>
                      <TD className="whitespace-nowrap text-xs text-ink-500">{formatDate(department.createdAt)}</TD>
                      <TD className="pr-6">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setEditing(department)}
                            aria-label={`Edit ${department.name}`}
                            title="Edit department"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                            onClick={() => openDelete(department)}
                            aria-label={`Delete ${department.name}`}
                            title="Delete department"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  ))
                ) : (
                  <TableEmpty colSpan={5}>
                    <div className="flex justify-center">
                      <EmptyState
                        className="py-10"
                        icon={<Building2 className="h-6 w-6" />}
                        title={search ? 'No departments match this search' : 'No departments yet'}
                        description={
                          search
                            ? 'Try a different department name or code.'
                            : 'Add the first academic department to start building the directory.'
                        }
                        action={
                          !search ? (
                            <Button size="sm" onClick={openCreate} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                              Add department
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
        </Card>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add a department"
        description="Departments appear in student profiles, clubs and event reports."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={createDepartment.isPending}>
              Cancel
            </Button>
            <Button type="submit" form="create-department-form" loading={createDepartment.isPending}>
              Add department
            </Button>
          </>
        }
      >
        <form id="create-department-form" onSubmit={createForm.handleSubmit(submitCreate)} className="space-y-4" noValidate>
          {createError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
              {createError}
            </div>
          ) : null}
          <Input
            label="Department name"
            placeholder="Computer Science and Engineering"
            error={createForm.formState.errors.name?.message}
            {...createForm.register('name')}
          />
          <Input
            label="Short code"
            placeholder="CSE"
            className="uppercase"
            maxLength={8}
            hint="2–8 letters, saved in uppercase. Codes must be unique."
            error={createForm.formState.errors.code?.message}
            {...createForm.register('code')}
          />
        </form>
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Edit department"
        description={editing ? `Update the details for ${editing.name}.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={updateDepartment.isPending}>
              Cancel
            </Button>
            <Button type="submit" form="edit-department-form" loading={updateDepartment.isPending}>
              Save changes
            </Button>
          </>
        }
      >
        <form id="edit-department-form" onSubmit={editForm.handleSubmit(submitEdit)} className="space-y-4" noValidate>
          {editError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
              {editError}
            </div>
          ) : null}
          <Input
            label="Department name"
            error={editForm.formState.errors.name?.message}
            {...editForm.register('name')}
          />
          <Input
            label="Short code"
            className="uppercase"
            maxLength={8}
            hint="2–8 letters, saved in uppercase."
            error={editForm.formState.errors.code?.message}
            {...editForm.register('code')}
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={closeDelete}
        onConfirm={() => {
          if (deleting) deleteDepartment.mutate(deleting.departmentId)
        }}
        title="Delete this department?"
        description={
          deleting
            ? deleteError ??
              `${deleting.name} will be permanently removed. Departments with enrolled students cannot be deleted.`
            : undefined
        }
        confirmLabel="Delete department"
        tone="danger"
        loading={deleteDepartment.isPending}
      />
    </div>
  )
}
