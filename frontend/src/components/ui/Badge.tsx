import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import type { ClubStatus, MembershipStatus, Role } from '@/types'

export type BadgeTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info' | 'brand' | 'acid'

const tones: Record<BadgeTone, string> = {
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
  warning: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  danger: 'bg-rose-50 text-rose-700 ring-rose-600/15',
  neutral: 'bg-ink-100 text-ink-600 ring-ink-500/10',
  info: 'bg-sky-50 text-sky-700 ring-sky-600/15',
  brand: 'bg-brand-50 text-brand-700 ring-brand-600/15',
  acid: 'bg-acid-200/70 text-ink-900 ring-ink-900/10',
}

export function Badge({
  tone = 'neutral',
  className,
  children,
  dot = false,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; dot?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.06em] ring-1 ring-inset',
        tones[tone],
        className,
      )}
      {...props}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden /> : null}
      {children}
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={statusTone(status.toLowerCase())} dot>
      {status.replaceAll('_', ' ')}
    </Badge>
  )
}

function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'approved':
    case 'published':
    case 'present':
    case 'active':
    case 'confirmed':
      return 'success'
    case 'pending':
    case 'draft':
    case 'waitlisted':
      return 'warning'
    case 'rejected':
    case 'inactive':
    case 'absent':
      return 'danger'
    case 'completed':
      return 'info'
    default:
      return 'neutral'
  }
}

export function RoleBadge({ role }: { role: Role }) {
  const tone: BadgeTone = role === 'admin' ? 'acid' : role === 'coordinator' ? 'brand' : 'neutral'
  return <Badge tone={tone}>{role}</Badge>
}

export function membershipTone(status: MembershipStatus): BadgeTone {
  if (status === 'approved') return 'success'
  if (status === 'pending') return 'warning'
  return 'danger'
}

export function clubTone(status: ClubStatus): BadgeTone {
  if (status === 'approved') return 'success'
  if (status === 'pending') return 'warning'
  return status === 'rejected' ? 'danger' : 'neutral'
}
