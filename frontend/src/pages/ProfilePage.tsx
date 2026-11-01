import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { toast } from 'sonner'
import { Building2, GraduationCap, KeyRound, Mail, ShieldCheck, UserRound } from 'lucide-react'
import { api, ApiError } from '@/services/api'
import { useAuth } from '@/context/AuthContext'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDate, initials } from '@/lib/utils'
import type { Department, SessionUser } from '@/types'
import { PageHeader } from '@/components/shared/PageChrome'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { RoleBadge } from '@/components/ui/Badge'

const profileSchema = z.object({
  fullName: z.string().min(2, 'Enter your full name.').max(120, 'Name is too long.'),
  departmentId: z.string().min(1, 'Select your department.'),
})

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters.')
      .regex(/[A-Za-z]/, 'Include at least one letter.')
      .regex(/[0-9]/, 'Include at least one number.'),
    confirmPassword: z.string().min(1, 'Confirm your new password.'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  })

type ProfileFormValues = z.infer<typeof profileSchema>
type PasswordFormValues = z.infer<typeof passwordSchema>

export default function ProfilePage() {
  usePageTitle('Profile')
  const { user, setUser } = useAuth()
  const [profileError, setProfileError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: () => api.get<Department[]>('/departments'),
    staleTime: 10 * 60 * 1000,
  })

  const profileForm = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      fullName: user?.student?.fullName ?? '',
      departmentId: user?.student?.departmentId ? String(user.student.departmentId) : '',
    },
  })

  const passwordForm = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })

  useEffect(() => {
    if (user?.student) {
      profileForm.reset({
        fullName: user.student.fullName,
        departmentId: String(user.student.departmentId),
      })
    }
  }, [user, profileForm])

  if (!user) return null

  const onSaveProfile = async (values: ProfileFormValues) => {
    setProfileError(null)
    try {
      const updated = await api.patch<SessionUser>('/auth/me', {
        fullName: values.fullName,
        departmentId: Number(values.departmentId),
      })
      setUser(updated)
      toast.success('Profile updated')
    } catch (error) {
      if (error instanceof ApiError) {
        for (const [field, message] of Object.entries(error.fields)) {
          if (field === 'fullName' || field === 'departmentId') {
            profileForm.setError(field, { message })
          }
        }
        setProfileError(error.message)
      } else {
        setProfileError('Could not update your profile.')
      }
    }
  }

  const onChangePassword = async (values: PasswordFormValues) => {
    setPasswordError(null)
    try {
      await api.post('/auth/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      })
      toast.success('Password changed')
      passwordForm.reset()
    } catch (error) {
      if (error instanceof ApiError) {
        for (const [field, message] of Object.entries(error.fields)) {
          if (field === 'currentPassword' || field === 'newPassword') {
            passwordForm.setError(field, { message })
          }
        }
        setPasswordError(error.message)
      } else {
        setPasswordError('Could not change your password.')
      }
    }
  }

  const displayName = user.student?.fullName ?? user.email

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Account"
        title="Profile & security"
        description="Keep your campus identity up to date and manage the credentials used to sign in."
      />

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <Card className="overflow-hidden">
          <div className="hero-wash relative px-6 pb-8 pt-7 text-white">
            <div className="surface-grid absolute inset-0 opacity-20" aria-hidden />
            <div className="relative">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 text-xl font-bold text-white ring-1 ring-inset ring-white/15 backdrop-blur">
                {initials(displayName)}
              </span>
              <h2 className="mt-4 text-lg font-bold tracking-[-0.02em]">{displayName}</h2>
              <p className="mt-0.5 text-xs text-white/55">{user.email}</p>
              <div className="mt-3">
                <RoleBadge role={user.role} />
              </div>
            </div>
          </div>
          <div className="space-y-4 p-6">
            <div className="flex items-start gap-3">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
              <div>
                <p className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-ink-400">Email</p>
                <p className="mt-0.5 break-all text-sm font-medium text-ink-800">{user.email}</p>
              </div>
            </div>
            {user.student ? (
              <>
                <div className="flex items-start gap-3">
                  <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                  <div>
                    <p className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-ink-400">Enrollment</p>
                    <p className="mt-0.5 text-sm font-medium text-ink-800">{user.student.enrollmentNumber}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                  <div>
                    <p className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-ink-400">Department</p>
                    <p className="mt-0.5 text-sm font-medium text-ink-800">{user.student.departmentName}</p>
                  </div>
                </div>
              </>
            ) : null}
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
              <div>
                <p className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-ink-400">Member since</p>
                <p className="mt-0.5 text-sm font-medium text-ink-800">{formatDate(user.createdAt)}</p>
              </div>
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          {user.student ? (
            <Card>
              <CardHeader
                title="Student profile"
                description="This is how you appear to clubs and coordinators."
              />
              <CardContent>
                <form onSubmit={profileForm.handleSubmit(onSaveProfile)} className="space-y-4" noValidate>
                  {profileError ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
                      {profileError}
                    </div>
                  ) : null}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                      label="Full name"
                      leftIcon={<UserRound className="h-4 w-4" />}
                      error={profileForm.formState.errors.fullName?.message}
                      {...profileForm.register('fullName')}
                    />
                    <Select
                      label="Department"
                      error={profileForm.formState.errors.departmentId?.message}
                      disabled={departments.isLoading}
                      {...profileForm.register('departmentId')}
                    >
                      <option value="">{departments.isLoading ? 'Loading…' : 'Select department'}</option>
                      {(departments.data ?? []).map((department) => (
                        <option key={department.departmentId} value={department.departmentId}>
                          {department.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" loading={profileForm.formState.isSubmitting}>
                      Save changes
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Password"
              description="Use a unique password you do not use anywhere else."
            />
            <CardContent>
              <form onSubmit={passwordForm.handleSubmit(onChangePassword)} className="space-y-4" noValidate>
                {passwordError ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
                    {passwordError}
                  </div>
                ) : null}
                <Input
                  label="Current password"
                  type="password"
                  autoComplete="current-password"
                  leftIcon={<KeyRound className="h-4 w-4" />}
                  error={passwordForm.formState.errors.currentPassword?.message}
                  {...passwordForm.register('currentPassword')}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="New password"
                    type="password"
                    autoComplete="new-password"
                    hint="At least 8 characters, one letter and one number."
                    error={passwordForm.formState.errors.newPassword?.message}
                    {...passwordForm.register('newPassword')}
                  />
                  <Input
                    label="Confirm new password"
                    type="password"
                    autoComplete="new-password"
                    error={passwordForm.formState.errors.confirmPassword?.message}
                    {...passwordForm.register('confirmPassword')}
                  />
                </div>
                <div className="flex justify-end">
                  <Button type="submit" variant="secondary" loading={passwordForm.formState.isSubmitting}>
                    Update password
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
