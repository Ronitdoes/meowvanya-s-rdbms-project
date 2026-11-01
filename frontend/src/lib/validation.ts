import { z } from 'zod'

const passwordRules = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .regex(/[A-Za-z]/, 'Include at least one letter.')
  .regex(/[0-9]/, 'Include at least one number.')

export const loginSchema = z.object({
  email: z.string().min(1, 'Email is required.').email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
})

export const registerSchema = z.object({
  fullName: z.string().min(2, 'Enter your full name.').max(120, 'Name is too long.'),
  email: z.string().min(1, 'Email is required.').email('Enter a valid email address.'),
  enrollmentNumber: z
    .string()
    .min(4, 'Enrollment number is too short.')
    .max(24, 'Enrollment number is too long.')
    .regex(/^[A-Za-z0-9-]+$/, 'Use letters, numbers or dashes only.'),
  departmentId: z.string().min(1, 'Select your department.'),
  password: passwordRules,
})

export const eventSchema = z
  .object({
    clubId: z.coerce.number().int().positive('Select a club.'),
    venueId: z.coerce.number().int().positive('Select a venue.'),
    title: z.string().min(3, 'Give the event a title.').max(160, 'Title is too long.'),
    description: z.string().max(3000, 'Description is too long.').default(''),
    eventDate: z.string().min(1, 'Choose the event date.'),
    registrationDeadline: z.string().min(1, 'Choose the registration deadline.'),
    capacity: z.coerce
      .number()
      .int()
      .positive('Capacity must be greater than zero.')
      .max(100000, 'Capacity looks too large.'),
  })
  .refine((data) => new Date(data.registrationDeadline) <= new Date(data.eventDate), {
    message: 'The deadline must be on or before the event date.',
    path: ['registrationDeadline'],
  })

export const feedbackSchema = z.object({
  rating: z.number().int().min(1, 'Choose a rating.').max(5),
  comments: z.string().max(1000, 'Keep feedback under 1000 characters.'),
})

export type LoginFormValues = z.infer<typeof loginSchema>
export type RegisterFormValues = z.infer<typeof registerSchema>
export type EventFormValues = z.infer<typeof eventSchema>
export type FeedbackFormValues = z.infer<typeof feedbackSchema>
