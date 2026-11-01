import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Clock3, MapPin, Users } from 'lucide-react'
import { cn, eventDateLabel, formatDayMonth, formatTime, isEventPast } from '@/lib/utils'
import type { CampusEvent } from '@/types'
import { Card } from '@/components/ui/Card'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import { CapacityBar } from './CapacityBar'
import { StarRating } from './Avatar'

export function EventCard({
  event,
  to,
  actions,
  showStatus = true,
  className,
}: {
  event: CampusEvent
  to?: string
  actions?: ReactNode
  showStatus?: boolean
  className?: string
}) {
  const date = formatDayMonth(event.eventDate)
  const registered = event.myRegistration?.status === 'confirmed'
  const past = isEventPast(event.eventDate)

  return (
    <Card
      className={cn(
        'group flex h-full flex-col overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift',
        className,
      )}
    >
      <div className="relative overflow-hidden bg-ink-950 px-5 py-4 text-white">
        <div className="surface-grid absolute inset-0 opacity-30" aria-hidden />
        <div className="absolute -right-6 -top-10 h-32 w-32 rounded-full bg-brand-500/30 blur-2xl" aria-hidden />
        <div className="relative flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 flex-col items-center justify-center rounded-2xl bg-white/10 ring-1 ring-inset ring-white/15 backdrop-blur">
              <span className="text-[0.5625rem] font-bold uppercase tracking-[0.14em] text-acid-300">{date.month}</span>
              <span className="text-lg font-bold leading-tight text-white">{date.day}</span>
            </div>
            <div>
              <p className="text-[0.625rem] font-bold uppercase tracking-[0.14em] text-white/50">Event date</p>
              <p className="mt-0.5 text-sm font-semibold text-white">{eventDateLabel(event.eventDate)}</p>
              <p className="flex items-center gap-1 text-xs text-white/55">
                <Clock3 className="h-3 w-3" /> {formatTime(event.eventDate)}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {showStatus ? <StatusBadge status={event.status} /> : null}
            {registered ? <Badge tone="acid">Registered</Badge> : null}
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="space-y-1.5">
          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-brand-700">{event.clubName}</p>
          <h3 className="text-lg font-bold leading-snug tracking-[-0.025em] text-ink-950">
            {to ? (
              <Link to={to} className="transition-colors hover:text-brand-700">
                {event.title}
              </Link>
            ) : (
              event.title
            )}
          </h3>
          <p className="line-clamp-2 text-[0.8125rem] leading-relaxed text-ink-500">{event.description}</p>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-500">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-ink-400" /> {event.venueName}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 text-ink-400" /> {past ? 'Finished' : eventDateLabel(event.eventDate)}
          </span>
          <StarRating rating={event.averageRating} count={event.feedbackCount} />
        </div>

        <div className="mt-auto space-y-3">
          <CapacityBar confirmed={event.confirmedRegistrations} capacity={event.capacity} />
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-[0.6875rem] font-semibold text-ink-400">
              <Users className="h-3.5 w-3.5" /> {event.confirmedRegistrations} going
            </span>
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
        </div>
      </div>
    </Card>
  )
}
