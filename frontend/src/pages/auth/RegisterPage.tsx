import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { Building2, Eye, EyeOff, Lock, Mail, ShieldCheck, UserRound } from 'lucide-react'
import { api, ApiError } from '@/services/api'
import { useAuth } from '@/context/AuthContext'
import { dashboardPath } from '@/lib/utils'
import { registerSchema, type RegisterFormValues } from '@/lib/validation'
import { usePageTitle } from '@/hooks/usePageTitle'
import type { Department } from '@/types'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'

export default function RegisterPage() {
  usePageTitle('Create account')
  const { register: createAccount } = useAuth()
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: () => api.get<Department[]>('/departments'),
    staleTime: 10 * 60 * 1000,
  })

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      fullName: '',
      email: '',
      enrollmentNumber: '',
      departmentId: '',
      password: '',
    },
  })

  const onSubmit = async (values: RegisterFormValues) => {
    setFormError(null)
    try {
      const user = await createAccount({
        email: values.email,
        password: values.password,
        fullName: values.fullName,
        enrollmentNumber: values.enrollmentNumber,
        departmentId: Number(values.departmentId),
      })
      navigate(dashboardPath(user.role), { replace: true })
    } catch (error) {
      if (error instanceof ApiError) {
        const entries = Object.entries(error.fields ?? {})
        if (entries.length > 0) {
          for (const [field, message] of entries) {
            if (field in values) {
              setError(field as keyof RegisterFormValues, { type: 'server', message })
            }
          }
          return
        }
        setFormError(error.message)
        return
      }
      setFormError('Unable to create your account. Please try again.')
    }
  }

  return (
    <AuthLayout backTo="/login">
      <div className="animate-fade-up">
        <p className="eyebrow">Get started</p>
        <h1 className="display-title mt-2 text-4xl leading-tight text-ink-950 sm:text-[2.75rem]">Join the campus.</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-500">
          One account for clubs, events, attendance and certificates. Use your college details to register.
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-4" noValidate>
          {formError ? (
            <div className="flex items-start gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              {formError}
            </div>
          ) : null}

          <Input
            label="Full name"
            autoComplete="name"
            placeholder="Aarav Sharma"
            leftIcon={<UserRound className="h-4 w-4" />}
            error={errors.fullName?.message}
            {...register('fullName')}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="College email"
              type="email"
              autoComplete="email"
              placeholder="you@college.edu"
              leftIcon={<Mail className="h-4 w-4" />}
              error={errors.email?.message}
              {...register('email')}
            />
            <Input
              label="Enrollment number"
              autoComplete="off"
              placeholder="CSE2026001"
              error={errors.enrollmentNumber?.message}
              {...register('enrollmentNumber')}
            />
          </div>

          <Select
            label="Department"
            error={errors.departmentId?.message}
            placeholder={departments.isLoading ? 'Loading departments…' : 'Select your department'}
            disabled={departments.isLoading}
            {...register('departmentId')}
          >
            {(departments.data ?? []).map((department) => (
              <option key={department.departmentId} value={department.departmentId}>
                {department.name} ({department.code})
              </option>
            ))}
          </Select>
          {departments.isError ? (
            <p className="flex items-center gap-1.5 text-xs text-rose-600">
              <Building2 className="h-3.5 w-3.5" /> Departments could not be loaded. Refresh the page to retry.
            </p>
          ) : null}

          <Input
            label="Password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            leftIcon={<Lock className="h-4 w-4" />}
            hint="Include at least one letter and one number."
            error={errors.password?.message}
            rightSlot={
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="rounded-lg p-2 text-ink-400 transition-colors hover:text-ink-700"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
            {...register('password')}
          />

          <Button type="submit" size="lg" className="mt-2 w-full" loading={isSubmitting}>
            Create student account
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-ink-500">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-brand-700 underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>

        <p className="mt-6 rounded-2xl border border-ink-200/70 bg-white/50 px-4 py-3 text-center text-[0.6875rem] leading-relaxed text-ink-400">
          Coordinator and administrator accounts are created by the campus administrator. Student accounts are
          self-service.
        </p>
      </div>
    </AuthLayout>
  )
}
