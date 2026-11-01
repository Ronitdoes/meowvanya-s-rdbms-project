import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/Card'

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
  to,
  className,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  tone?: 'default' | 'brand' | 'dark' | 'acid'
  to?: string
  className?: string
}) {
  const tones = {
    default: 'bg-white text-ink-900 border-ink-200/70',
    brand: 'bg-brand-50 text-ink-900 border-brand-200/60',
    dark: 'hero-wash text-white border-ink-900',
    acid: 'bg-acid-200/70 text-ink-950 border-acid-300',
  }

  const body = (
    <Card className={cn('group relative overflow-hidden p-5 transition-all duration-200', tones[tone], to && 'hover:-translate-y-0.5 hover:shadow-lift', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className={cn('text-xs font-bold uppercase tracking-[0.1em]', tone === 'dark' ? 'text-white/60' : 'text-ink-400')}>
          {label}
        </p>
        {icon ? (
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
              tone === 'dark' ? 'bg-white/10 text-acid-300' : 'bg-ink-100/80 text-ink-600',
              tone === 'acid' && 'bg-white/50 text-ink-800',
            )}
          >
            {icon}
          </span>
        ) : to ? (
          <ArrowUpRight className="h-4 w-4 text-ink-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        ) : null}
      </div>
      <p className="mt-4 text-[2rem] font-bold leading-none tracking-[-0.04em]">{value}</p>
      {hint ? (
        <p className={cn('mt-2 flex items-center gap-1 text-xs', tone === 'dark' ? 'text-white/55' : 'text-ink-500')}>
          {hint}
        </p>
      ) : null}
    </Card>
  )

  return to ? <Link to={to}>{body}</Link> : body
}

export function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl bg-ink-50 px-4 py-3">
      <p className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-ink-400">{label}</p>
      <p className="mt-1 text-lg font-bold tracking-[-0.03em] text-ink-900">{value}</p>
    </div>
  )
}

export function TrendPill({ value, label }: { value: number; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[0.6875rem] font-bold text-emerald-700">
      <TrendingUp className="h-3 w-3" />
      {value > 0 ? '+' : ''}
      {value}%{label ? <span className="font-medium text-emerald-600/70">{label}</span> : null}
    </span>
  )
}
