import { cn } from '@/lib/utils'

export function CapacityBar({
  confirmed,
  capacity,
  showLabel = true,
  className,
}: {
  confirmed: number
  capacity: number
  showLabel?: boolean
  className?: string
}) {
  const pct = capacity > 0 ? Math.min(100, Math.round((confirmed / capacity) * 100)) : 0
  const remaining = Math.max(0, capacity - confirmed)
  const tone = pct >= 90 ? 'bg-rose-500' : pct >= 70 ? 'bg-sun-400' : 'bg-brand-500'

  return (
    <div className={cn('space-y-1.5', className)}>
      {showLabel ? (
        <div className="flex items-center justify-between text-[0.6875rem] font-semibold">
          <span className="text-ink-400">
            {confirmed} / {capacity} seats
          </span>
          <span className={cn(remaining === 0 ? 'text-rose-600' : 'text-ink-500')}>
            {remaining === 0 ? 'Full' : `${remaining} left`}
          </span>
        </div>
      ) : null}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
        <div className={cn('h-full rounded-full transition-all duration-500', tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
