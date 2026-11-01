import { describe, expect, it } from 'vitest'
import { eventSchema, feedbackSchema, loginSchema, registerSchema } from './validation'

function messageFor(result: { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } }, field: string) {
  return result.error.issues.find((issue) => issue.path[0] === field)?.message
}

describe('loginSchema', () => {
  it('accepts a valid email and password', () => {
    const result = loginSchema.safeParse({ email: 'student01@campusconnect.test', password: 'Password123!' })
    expect(result.success).toBe(true)
  })

  it('requires both fields', () => {
    const result = loginSchema.safeParse({ email: '', password: '' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(messageFor(result, 'email')).toBe('Email is required.')
    expect(messageFor(result, 'password')).toBe('Password is required.')
  })

  it('rejects a malformed email address', () => {
    const result = loginSchema.safeParse({ email: 'not-an-email', password: 'Password123!' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(messageFor(result, 'email')).toBe('Enter a valid email address.')
  })
})

describe('registerSchema', () => {
  const valid = {
    fullName: 'Priya Sharma',
    email: 'priya@campusconnect.test',
    enrollmentNumber: 'CS-2024-001',
    departmentId: '2',
    password: 'Password123!',
  }

  it('accepts a valid registration with a string department id', () => {
    const result = registerSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.departmentId).toBe('2')
  })

  it('requires a department to be selected', () => {
    const result = registerSchema.safeParse({ ...valid, departmentId: '' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(messageFor(result, 'departmentId')).toBe('Select your department.')
  })

  it('rejects a numeric department id because the form value is a string', () => {
    const result = registerSchema.safeParse({ ...valid, departmentId: 2 })
    expect(result.success).toBe(false)
  })

  it('enforces the password strength rules', () => {
    const short = registerSchema.safeParse({ ...valid, password: 'Ab1' })
    expect(short.success).toBe(false)
    if (!short.success) expect(messageFor(short, 'password')).toBe('Password must be at least 8 characters.')

    const lettersOnly = registerSchema.safeParse({ ...valid, password: 'PasswordOnly' })
    expect(lettersOnly.success).toBe(false)
    if (!lettersOnly.success) expect(messageFor(lettersOnly, 'password')).toBe('Include at least one number.')
  })

  it('rejects an enrollment number with invalid characters', () => {
    const result = registerSchema.safeParse({ ...valid, enrollmentNumber: 'CS 2024!' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(messageFor(result, 'enrollmentNumber')).toBe('Use letters, numbers or dashes only.')
  })
})

describe('eventSchema', () => {
  const valid = {
    clubId: '2',
    venueId: '1',
    title: 'Spring Hackathon',
    description: 'A 24 hour build sprint.',
    eventDate: '2026-05-10T10:00:00.000Z',
    registrationDeadline: '2026-05-01T10:00:00.000Z',
    capacity: '100',
  }

  it('coerces numeric fields and accepts a deadline before the event', () => {
    const result = eventSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.clubId).toBe(2)
      expect(result.data.venueId).toBe(1)
      expect(result.data.capacity).toBe(100)
    }
  })

  it('accepts a deadline exactly on the event date', () => {
    const result = eventSchema.safeParse({ ...valid, registrationDeadline: valid.eventDate })
    expect(result.success).toBe(true)
  })

  it('rejects a deadline after the event date', () => {
    const result = eventSchema.safeParse({ ...valid, registrationDeadline: '2026-05-11T10:00:00.000Z' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(messageFor(result, 'registrationDeadline')).toBe('The deadline must be on or before the event date.')
  })

  it('requires a positive capacity and a club', () => {
    const result = eventSchema.safeParse({ ...valid, clubId: '0', capacity: '0' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(messageFor(result, 'clubId')).toBe('Select a club.')
    expect(messageFor(result, 'capacity')).toBe('Capacity must be greater than zero.')
  })
})

describe('feedbackSchema', () => {
  it('accepts ratings from 1 to 5', () => {
    for (const rating of [1, 3, 5]) {
      expect(feedbackSchema.safeParse({ rating, comments: 'Great event.' }).success).toBe(true)
    }
  })

  it('rejects a rating below the minimum', () => {
    const result = feedbackSchema.safeParse({ rating: 0, comments: '' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(messageFor(result, 'rating')).toBe('Choose a rating.')
  })

  it('rejects a rating above the maximum', () => {
    const result = feedbackSchema.safeParse({ rating: 6, comments: '' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.some((issue) => issue.path[0] === 'rating')).toBe(true)
  })

  it('rejects fractional ratings', () => {
    const result = feedbackSchema.safeParse({ rating: 3.5, comments: '' })
    expect(result.success).toBe(false)
  })

  it('limits comments to 1000 characters', () => {
    const result = feedbackSchema.safeParse({ rating: 4, comments: 'x'.repeat(1001) })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(messageFor(result, 'comments')).toBe('Keep feedback under 1000 characters.')
  })
})
