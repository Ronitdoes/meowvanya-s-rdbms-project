import { describe, expect, it } from 'vitest'
import {
  cn,
  dashboardPath,
  eventDateLabel,
  formatDate,
  formatDateTime,
  initials,
  inputDateTimeValue,
  percent,
  pluralize,
  toISOStringFromInput,
} from './utils'

describe('cn', () => {
  it('merges conflicting tailwind classes, keeping the last one', () => {
    expect(cn('px-2 text-sm', 'px-4')).toBe('text-sm px-4')
  })

  it('drops falsy values and joins the rest', () => {
    const isHidden = false
    expect(cn('flex', isHidden && 'hidden', undefined, null, 'gap-2')).toBe('flex gap-2')
  })
})

describe('formatDate and formatDateTime', () => {
  it('formats valid dates using the requested pattern', () => {
    expect(formatDate('2026-04-12T00:00:00')).toBe('12 Apr 2026')
    expect(formatDate('2026-04-12T00:00:00', 'yyyy-MM-dd')).toBe('2026-04-12')
    expect(formatDateTime('2026-04-12T14:05:00')).toBe('12 Apr 2026, 2:05 PM')
  })

  it('falls back to a dash for invalid values', () => {
    expect(formatDate('not-a-date')).toBe('—')
    expect(formatDate(new Date('nonsense'))).toBe('—')
    expect(formatDateTime('not-a-date')).toBe('—')
    expect(formatDateTime(new Date(Number.NaN))).toBe('—')
  })
})

describe('eventDateLabel', () => {
  it('labels the current day as Today', () => {
    expect(eventDateLabel(new Date())).toBe('Today')
  })

  it('labels the following day as Tomorrow', () => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    expect(eventDateLabel(tomorrow)).toBe('Tomorrow')
  })

  it('falls back to a formatted date further out', () => {
    expect(eventDateLabel('2099-12-15T10:00:00')).toMatch(/^[A-Z][a-z]{2}, 15 Dec$/)
  })

  it('returns a dash for invalid values', () => {
    expect(eventDateLabel('not-a-date')).toBe('—')
  })
})

describe('initials', () => {
  it('uses the first letters of the first two words', () => {
    expect(initials('Priya Sharma')).toBe('PS')
    expect(initials('Rahul Kumar Verma')).toBe('RK')
  })

  it('handles a single word and extra whitespace', () => {
    expect(initials('  Aarav  ')).toBe('A')
  })

  it('returns a placeholder for missing names', () => {
    expect(initials()).toBe('??')
    expect(initials(null)).toBe('??')
    expect(initials('')).toBe('??')
  })
})

describe('pluralize', () => {
  it('keeps the singular form for exactly one', () => {
    expect(pluralize(1, 'event')).toBe('1 event')
    expect(pluralize(1, 'person', 'people')).toBe('1 person')
  })

  it('uses the plural form otherwise', () => {
    expect(pluralize(0, 'event')).toBe('0 events')
    expect(pluralize(3, 'event')).toBe('3 events')
    expect(pluralize(2, 'person', 'people')).toBe('2 people')
  })
})

describe('percent', () => {
  it('rounds the percentage of part over total', () => {
    expect(percent(25, 100)).toBe(25)
    expect(percent(1, 3)).toBe(33)
    expect(percent(2, 3)).toBe(67)
  })

  it('returns zero when the total is zero', () => {
    expect(percent(5, 0)).toBe(0)
    expect(percent(0, 0)).toBe(0)
  })
})

describe('dashboardPath', () => {
  it('routes each role to its dashboard', () => {
    expect(dashboardPath('admin')).toBe('/admin/dashboard')
    expect(dashboardPath('coordinator')).toBe('/coordinator/dashboard')
    expect(dashboardPath('student')).toBe('/student/dashboard')
  })

  it('defaults to the student dashboard for missing roles', () => {
    expect(dashboardPath()).toBe('/student/dashboard')
    expect(dashboardPath(null)).toBe('/student/dashboard')
  })
})

describe('inputDateTimeValue', () => {
  it('formats an ISO value for a datetime-local input', () => {
    expect(inputDateTimeValue('2026-04-12T09:30:00')).toBe('2026-04-12T09:30')
  })

  it('returns an empty string for empty or invalid values', () => {
    expect(inputDateTimeValue()).toBe('')
    expect(inputDateTimeValue(null)).toBe('')
    expect(inputDateTimeValue('not-a-date')).toBe('')
  })
})

describe('toISOStringFromInput', () => {
  it('converts a datetime-local value to an ISO string', () => {
    const localValue = '2026-04-12T09:30'
    expect(toISOStringFromInput(localValue)).toBe(new Date(localValue).toISOString())
    expect(toISOStringFromInput(localValue)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('returns the original string when it cannot be parsed', () => {
    expect(toISOStringFromInput('not-a-date')).toBe('not-a-date')
    expect(toISOStringFromInput('')).toBe('')
  })
})
