import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Crown, Users, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Club } from '@/types'
import { Card } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/Badge'

const marks = ['bg-brand-600', 'bg-ink-950', 'bg-amber-600', 'bg-sky-700', 'bg-rose-700', 'bg-violet-700']

export function ClubCard({
  club,
  to,
  actions,
  showStatus = false,
  className,
}: {
  club: Club
  to?: string
  actions?: ReactNode
  showStatus?: boolean
  className?: string
}) {
  const mark = marks[club.clubId % marks.length]
  const monogram = club.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('')

  return (
    <Card
      className={cn(
        'group flex h-full flex-col p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={cn('flex h-12 w-12 items-center justify-center rounded-2xl text-sm font-bold text-white shadow-sm', mark)}>
          {monogram}
        </span>
        <div className="flex items-center gap-1.5">
          {showStatus ? <StatusBadge status={club.status} /> : null}
          {to ? (
            <Link
              to={to}
              className="rounded-full p-1.5 text-ink-300 transition-colors hover:bg-ink-100 hover:text-ink-700"
              aria-label={`View ${club.name}`}
            >
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex-1 space-y-1.5">
        <h3 className="text-base font-bold tracking-[-0.02em] text-ink-950">
          {to ? (
            <Link to={to} className="transition-colors hover:text-brand-700">
              {club.name}
            </Link>
          ) : (
            club.name
          )}
        </h3>
        <p className="line-clamp-2 text-[0.8125rem] leading-relaxed text-ink-500">{club.description || 'No description yet.'}</p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-500">
        <span className="inline-flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-ink-400" /> {club.approvedMembers} members
        </span>
        {club.pendingRequests > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-amber-700">
            <Clock className="h-3.5 w-3.5" /> {club.pendingRequests} pending
          </span>
        ) : null}
        {club.coordinatorName ? (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Crown className="h-3.5 w-3.5 shrink-0 text-ink-400" />
            <span className="truncate">{club.coordinatorName}</span>
          </span>
        ) : null}
      </div>

      {actions ? <div className="mt-5 flex items-center gap-2">{actions}</div> : null}
    </Card>
  )
}
