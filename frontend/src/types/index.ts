export type Role = 'student' | 'coordinator' | 'admin'

export type ClubStatus = 'pending' | 'approved' | 'rejected' | 'inactive'
export type EventStatus = 'draft' | 'pending' | 'published' | 'rejected' | 'completed' | 'cancelled'
export type MembershipStatus = 'pending' | 'approved' | 'rejected'
export type RegistrationStatus = 'confirmed' | 'cancelled' | 'waitlisted'
export type AttendanceStatus = 'present' | 'absent'

export interface Student {
  studentId: number
  userId: number
  email: string
  fullName: string
  enrollmentNumber: string
  departmentId: number
  departmentName: string
  isActive: boolean
  createdAt: string
}

export interface User {
  userId: number
  email: string
  role: Role
  isActive: boolean
  createdAt: string
  student?: Student | null
}

export interface SessionUser extends User {
  csrfToken?: string
}

export interface Department {
  departmentId: number
  name: string
  code: string
  studentCount: number
  createdAt: string
}

export interface Club {
  clubId: number
  name: string
  description: string
  status: ClubStatus
  createdAt: string
  approvedMembers: number
  pendingRequests: number
  coordinatorName?: string | null
  coordinatorEmail?: string | null
  myRole?: string | null
  myStatus?: MembershipStatus | null
}

export interface ClubMember {
  membershipId: number
  studentId: number
  clubId: number
  clubName: string
  fullName: string
  email: string
  enrollmentNumber: string
  departmentName: string
  role: 'member' | 'coordinator'
  status: MembershipStatus
  requestedAt: string
  decidedAt?: string | null
  joinedAt?: string | null
}

export interface MembershipRequest {
  membershipId: number
  clubId: number
  clubName: string
  status: MembershipStatus
  role: 'member' | 'coordinator'
  requestedAt: string
  decidedAt?: string | null
  joinedAt?: string | null
}

export interface Venue {
  venueId: number
  name: string
  capacity: number
  location: string
  eventCount: number
  createdAt: string
}

export interface RegistrationSummary {
  registrationId: number
  status: RegistrationStatus
  registeredAt: string
  cancelledAt?: string | null
  attendanceStatus?: AttendanceStatus | null
  certificateCode?: string | null
}

export interface CampusEvent {
  eventId: number
  clubId: number
  clubName: string
  venueId: number
  venueName: string
  venueCapacity: number
  createdBy?: number | null
  title: string
  description: string
  eventDate: string
  registrationDeadline: string
  capacity: number
  status: EventStatus
  rejectionReason?: string | null
  createdAt: string
  updatedAt: string
  confirmedRegistrations: number
  totalRegistrations: number
  seatsRemaining: number
  averageRating?: number | null
  feedbackCount: number
  myRegistration?: RegistrationSummary | null
}

export interface Registration {
  registrationId: number
  studentId: number
  eventId: number
  studentName: string
  email: string
  enrollmentNumber: string
  departmentName: string
  clubName: string
  eventTitle: string
  eventDate: string
  venueName: string
  status: RegistrationStatus
  registeredAt: string
  cancelledAt?: string | null
  attendanceStatus?: AttendanceStatus | null
  certificateCode?: string | null
  certificateId?: number | null
}

export interface Attendance {
  attendanceId: number
  registrationId: number
  studentId: number
  studentName: string
  enrollmentNumber: string
  attendanceStatus: AttendanceStatus
  markedAt: string
  certificateCode?: string | null
}

export interface Feedback {
  feedbackId: number
  eventId: number
  studentId: number
  studentName: string
  rating: number
  comments: string
  createdAt: string
}

export interface Certificate {
  certificateId: number
  registrationId: number
  certificateCode: string
  issueDate: string
  eventId: number
  eventTitle: string
  eventDate: string
  clubName: string
  studentName: string
}

export interface EventStats {
  eventId: number
  title: string
  capacity: number
  totalRegistrations: number
  confirmedRegistrations: number
  cancelledRegistrations: number
  presentCount: number
  absentCount: number
  averageRating?: number | null
  feedbackCount: number
}

export interface StudentDashboard {
  clubsJoined: number
  approvedMemberships: number
  pendingMemberships: number
  eventsRegistered: number
  upcomingRegistrations: number
  certificatesEarned: number
  upcomingEvents: CampusEvent[]
  recentRegistrations: Registration[]
}

export interface CoordinatorStats {
  clubs: number
  totalEvents: number
  publishedEvents: number
  upcomingEvents: number
  approvedMembers: number
  pendingMembers: number
  totalRegistrations: number
  certificatesIssued: number
  averageRating: number
  pendingEvents: number
}

export interface CoordinatorDashboard {
  clubs: Club[]
  stats: CoordinatorStats
  pendingMembers: ClubMember[]
  upcomingEvents: CampusEvent[]
  recentFeedback: Feedback[]
}

export interface AdminStats {
  totalUsers: number
  totalStudents: number
  totalClubs: number
  approvedClubs: number
  pendingClubs: number
  totalEvents: number
  publishedEvents: number
  pendingEvents: number
  confirmedRegistrations: number
  certificatesIssued: number
  averageFeedbackRating: number
  totalDepartments: number
  totalVenues: number
}

export interface ChartPoint {
  label: string
  value: number
}

export interface AdminDashboard {
  stats: AdminStats
  pendingClubs: Club[]
  pendingEvents: CampusEvent[]
  recentRegistrations: Registration[]
  registrationsByMonth: ChartPoint[]
  membersByClub: ChartPoint[]
  feedbackDistribution: ChartPoint[]
}

export interface PaginationMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface ListResult<T> {
  data: T[]
  meta: PaginationMeta
}

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    fields?: Record<string, string>
  }
}

export interface LoginInput {
  email: string
  password: string
}

export interface RegisterInput {
  email: string
  password: string
  fullName: string
  enrollmentNumber: string
  departmentId: number
}

export interface CreateEventInput {
  clubId: number
  venueId: number
  title: string
  description: string
  eventDate: string
  registrationDeadline: string
  capacity: number
}

export type UpdateEventInput = Partial<CreateEventInput>

export interface CreateStudentInput {
  email: string
  password: string
  fullName: string
  enrollmentNumber: string
  departmentId: number
  role?: 'student' | 'coordinator'
}

export interface CreateClubInput {
  name: string
  description: string
  status?: ClubStatus
}

export interface CreateVenueInput {
  name: string
  capacity: number
  location: string
}

export interface CreateDepartmentInput {
  name: string
  code: string
}
