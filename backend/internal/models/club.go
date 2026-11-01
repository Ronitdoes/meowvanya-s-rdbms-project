package models

import "time"

type Club struct {
	ClubID           int64     `json:"clubId"`
	Name             string    `json:"name"`
	Description      string    `json:"description"`
	Status           string    `json:"status"`
	CreatedAt        time.Time `json:"createdAt"`
	ApprovedMembers  int       `json:"approvedMembers"`
	PendingRequests  int       `json:"pendingRequests"`
	CoordinatorName  *string   `json:"coordinatorName,omitempty"`
	CoordinatorEmail *string   `json:"coordinatorEmail,omitempty"`
	MyRole           *string   `json:"myRole,omitempty"`
	MyStatus         *string   `json:"myStatus,omitempty"`
}

type ClubMember struct {
	MembershipID     int64      `json:"membershipId"`
	StudentID        int64      `json:"studentId"`
	ClubID           int64      `json:"clubId"`
	ClubName         string     `json:"clubName"`
	FullName         string     `json:"fullName"`
	Email            string     `json:"email"`
	EnrollmentNumber string     `json:"enrollmentNumber"`
	DepartmentName   string     `json:"departmentName"`
	Role             string     `json:"role"`
	Status           string     `json:"status"`
	RequestedAt      time.Time  `json:"requestedAt"`
	DecidedAt        *time.Time `json:"decidedAt,omitempty"`
	JoinedAt         *time.Time `json:"joinedAt,omitempty"`
}

type MembershipRequest struct {
	MembershipID int64      `json:"membershipId"`
	ClubID       int64      `json:"clubId"`
	ClubName     string     `json:"clubName"`
	Status       string     `json:"status"`
	Role         string     `json:"role"`
	RequestedAt  time.Time  `json:"requestedAt"`
	DecidedAt    *time.Time `json:"decidedAt,omitempty"`
	JoinedAt     *time.Time `json:"joinedAt,omitempty"`
}

type Venue struct {
	VenueID    int64     `json:"venueId"`
	Name       string    `json:"name"`
	Capacity   int       `json:"capacity"`
	Location   string    `json:"location"`
	EventCount int       `json:"eventCount"`
	CreatedAt  time.Time `json:"createdAt"`
}
