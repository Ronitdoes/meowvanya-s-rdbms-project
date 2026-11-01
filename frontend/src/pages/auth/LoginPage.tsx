import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff, Lock, Mail, ShieldCheck } from 'lucide-react'
import { ApiError } from '@/services/api'
import { useAuth } from '@/context/AuthContext'
import { dashboardPath } from '@/lib/utils'
import { loginSchema, type LoginFormValues } from '@/lib/validation'
import { usePageTitle } from '@/hooks/usePageTitle'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

const demoAccounts = [
  { label: 'Student', email: 'student01@campusconnect.test', password: 'Password123!', tone: 'bg-ink-100 text-ink-700' },
  { label: 'Coordinator', email: 'priya@campusconnect.test', password: 'Coordinator123!', tone: 'bg-brand-50 text-brand-700' },
  { label: 'Admin', email: 'admin@campusconnect.test', password: 'Admin123!', tone: 'bg-acid-200 text-ink-800' },
]

export default function LoginPage() {
  usePageTitle('Sign in')
  const { login } = useAuth()
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = async (values: LoginFormValues) => {
    setFormError(null)
    try {
      const user = await login(values)
      navigate(dashboardPath(user.role), { replace: true })
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Unable to sign in. Please try again.')
    }
  }

  const fillDemo = (email: string, password: string) => {
    setValue('email', email, { shouldValidate: true })
    setValue('password', password, { shouldValidate: true })
    setFormError(null)
  }

  return (
    <AuthLayout backTo="/">
      <div className="animate-fade-up">
        <p className="eyebrow">Welcome back</p>
        <h1 className="display-title mt-2 text-4xl leading-tight text-ink-950 sm:text-[2.75rem]">Sign in to campus.</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-500">
          Use your college email to access clubs, events and everything you have signed up for.
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-4" noValidate>
          {formError ? (
            <div className="flex items-start gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              {formError}
            </div>
          ) : null}

          <Input
            label="Email address"
            type="email"
            autoComplete="email"
            placeholder="you@college.edu"
            leftIcon={<Mail className="h-4 w-4" />}
            error={errors.email?.message}
            {...register('email')}
          />

          <Input
            label="Password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="Enter your password"
            leftIcon={<Lock className="h-4 w-4" />}
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
            Sign in
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-ink-500">
          New to CampusConnect?{' '}
          <Link to="/register" className="font-semibold text-brand-700 underline-offset-4 hover:underline">
            Create a student account
          </Link>
        </p>

        <div className="mt-9 rounded-3xl border border-ink-200/80 bg-white/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-ink-400">Demo accounts</p>
            <span className="text-[0.625rem] text-ink-400">Password shown below</span>
          </div>
          <div className="mt-3 space-y-2">
            {demoAccounts.map((account) => (
              <button
                key={account.label}
                type="button"
                onClick={() => fillDemo(account.email, account.password)}
                className="flex w-full items-center justify-between gap-3 rounded-2xl border border-transparent px-2.5 py-2 text-left transition-colors hover:border-ink-200 hover:bg-white"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className={`rounded-full px-2 py-1 text-[0.5625rem] font-bold uppercase tracking-[0.08em] ${account.tone}`}>
                    {account.label}
                  </span>
                  <span className="truncate text-xs text-ink-600">{account.email}</span>
                </span>
                <span className="hidden text-[0.625rem] font-mono text-ink-400 sm:block">{account.password}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </AuthLayout>
  )
}
