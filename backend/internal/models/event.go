package models

import "time"

type Event struct {
	EventID              int64                `json:"eventId"`
	ClubID               int64                `json:"clubId"`
	ClubName             string               `json:"clubName"`
	VenueID              int64                `json:"venueId"`
	VenueName            string               `json:"venueName"`
	VenueCapacity        int                  `json:"venueCapacity"`
	CreatedBy            *int64               `json:"createdBy,omitempty"`
	Title                string               `json:"title"`
	Description          string               `json:"description"`
	EventDate            time.Time            `json:"eventDate"`
	RegistrationDeadline time.Time            `json:"registrationDeadline"`
	Capacity             int                  `json:"capacity"`
	Status               string               `json:"status"`
	RejectionReason      *string              `json:"rejectionReason,omitempty"`
	CreatedAt            time.Time            `json:"createdAt"`
	UpdatedAt            time.Time            `json:"updatedAt"`
	ConfirmedCount       int                  `json:"confirmedRegistrations"`
	TotalRegistrations   int                  `json:"totalRegistrations"`
	SeatsRemaining       int                  `json:"seatsRemaining"`
	AverageRating        *float64             `json:"averageRating,omitempty"`
	FeedbackCount        int                  `json:"feedbackCount"`
	MyRegistration       *RegistrationSummary `json:"myRegistration,omitempty"`
}

type RegistrationSummary struct {
	RegistrationID   int64      `json:"registrationId"`
	Status           string     `json:"status"`
	RegisteredAt     time.Time  `json:"registeredAt"`
	CancelledAt      *time.Time `json:"cancelledAt,omitempty"`
	AttendanceStatus *string    `json:"attendanceStatus,omitempty"`
	CertificateCode  *string    `json:"certificateCode,omitempty"`
}

type Registration struct {
	RegistrationID   int64      `json:"registrationId"`
	StudentID        int64      `json:"studentId"`
	EventID          int64      `json:"eventId"`
	StudentName      string     `json:"studentName"`
	Email            string     `json:"email"`
	EnrollmentNumber string     `json:"enrollmentNumber"`
	DepartmentName   string     `json:"departmentName"`
	ClubName         string     `json:"clubName"`
	EventTitle       string     `json:"eventTitle"`
	EventDate        time.Time  `json:"eventDate"`
	VenueName        string     `json:"venueName"`
	Status           string     `json:"status"`
	RegisteredAt     time.Time  `json:"registeredAt"`
	CancelledAt      *time.Time `json:"cancelledAt,omitempty"`
	AttendanceStatus *string    `json:"attendanceStatus,omitempty"`
	CertificateCode  *string    `json:"certificateCode,omitempty"`
	CertificateID    *int64     `json:"certificateId,omitempty"`
}

type Attendance struct {
	AttendanceID     int64     `json:"attendanceId"`
	RegistrationID   int64     `json:"registrationId"`
	StudentID        int64     `json:"studentId"`
	StudentName      string    `json:"studentName"`
	EnrollmentNumber string    `json:"enrollmentNumber"`
	AttendanceStatus string    `json:"attendanceStatus"`
	MarkedAt         time.Time `json:"markedAt"`
	CertificateCode  *string   `json:"certificateCode,omitempty"`
}

type Feedback struct {
	FeedbackID  int64     `json:"feedbackId"`
	EventID     int64     `json:"eventId"`
	StudentID   int64     `json:"studentId"`
	StudentName string    `json:"studentName"`
	Rating      int       `json:"rating"`
	Comments    string    `json:"comments"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Certificate struct {
	CertificateID   int64     `json:"certificateId"`
	RegistrationID  int64     `json:"registrationId"`
	CertificateCode string    `json:"certificateCode"`
	IssueDate       time.Time `json:"issueDate"`
	EventID         int64     `json:"eventId"`
	EventTitle      string    `json:"eventTitle"`
	EventDate       time.Time `json:"eventDate"`
	ClubName        string    `json:"clubName"`
	StudentName     string    `json:"studentName"`
}

type EventStats struct {
	EventID                int64    `json:"eventId"`
	Title                  string   `json:"title"`
	Capacity               int      `json:"capacity"`
	TotalRegistrations     int      `json:"totalRegistrations"`
	ConfirmedRegistrations int      `json:"confirmedRegistrations"`
	CancelledRegistrations int      `json:"cancelledRegistrations"`
	PresentCount           int      `json:"presentCount"`
	AbsentCount            int      `json:"absentCount"`
	AverageRating          *float64 `json:"averageRating,omitempty"`
	FeedbackCount          int      `json:"feedbackCount"`
}
