import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNowStrict, isToday, isTomorrow, isPast, parseISO } from 'date-fns'
import type { EventStatus, RegistrationStatus, Role } from '@/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(value: string | Date, pattern = 'd MMM yyyy') {
  const date = typeof value === 'string' ? parseISO(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return format(date, pattern)
}

export function formatDateTime(value: string | Date) {
  const date = typeof value === 'string' ? parseISO(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return format(date, 'd MMM yyyy, h:mm a')
}

export function formatTime(value: string | Date) {
  const date = typeof value === 'string' ? parseISO(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return format(date, 'h:mm a')
}

export function formatDayMonth(value: string | Date) {
  const date = typeof value === 'string' ? parseISO(value) : value
  if (Number.isNaN(date.getTime())) return { day: '—', month: '—' }
  return { day: format(date, 'dd'), month: format(date, 'MMM') }
}

export function relativeTime(value: string | Date) {
  const date = typeof value === 'string' ? parseISO(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return formatDistanceToNowStrict(date, { addSuffix: true })
}

export function eventDateLabel(value: string | Date) {
  const date = typeof value === 'string' ? parseISO(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  if (isToday(date)) return 'Today'
  if (isTomorrow(date)) return 'Tomorrow'
  return formatDate(date, 'EEE, d MMM')
}

export function isEventPast(value: string) {
  return isPast(parseISO(value))
}

export function inputDateTimeValue(value?: string | null) {
  if (!value) return ''
  const date = parseISO(value)
  if (Number.isNaN(date.getTime())) return ''
  return format(date, "yyyy-MM-dd'T'HH:mm")
}

export function toISOStringFromInput(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

export function initials(name?: string | null) {
  if (!name) return '??'
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

export function percent(part: number, total: number) {
  if (!total) return 0
  return Math.round((part / total) * 100)
}

export function dashboardPath(role?: Role | null) {
  switch (role) {
    case 'admin':
      return '/admin/dashboard'
    case 'coordinator':
      return '/coordinator/dashboard'
    default:
      return '/student/dashboard'
  }
}

export function eventStatusTone(status: EventStatus) {
  switch (status) {
    case 'published':
      return 'success' as const
    case 'pending':
      return 'warning' as const
    case 'rejected':
    case 'cancelled':
      return 'danger' as const
    case 'completed':
      return 'neutral' as const
    default:
      return 'info' as const
  }
}

export function registrationStatusTone(status: RegistrationStatus) {
  switch (status) {
    case 'confirmed':
      return 'success' as const
    case 'waitlisted':
      return 'warning' as const
    default:
      return 'neutral' as const
  }
}
