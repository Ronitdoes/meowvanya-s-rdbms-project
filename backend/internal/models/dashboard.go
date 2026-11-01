package models

type StudentDashboard struct {
	ClubsJoined           int            `json:"clubsJoined"`
	ApprovedMemberships   int            `json:"approvedMemberships"`
	PendingMemberships    int            `json:"pendingMemberships"`
	EventsRegistered      int            `json:"eventsRegistered"`
	UpcomingRegistrations int            `json:"upcomingRegistrations"`
	CertificatesEarned    int            `json:"certificatesEarned"`
	UpcomingEvents        []Event        `json:"upcomingEvents"`
	RecentRegistrations   []Registration `json:"recentRegistrations"`
}

type CoordinatorStats struct {
	Clubs              int     `json:"clubs"`
	TotalEvents        int     `json:"totalEvents"`
	PublishedEvents    int     `json:"publishedEvents"`
	UpcomingEvents     int     `json:"upcomingEvents"`
	ApprovedMembers    int     `json:"approvedMembers"`
	PendingMembers     int     `json:"pendingMembers"`
	TotalRegistrations int     `json:"totalRegistrations"`
	CertificatesIssued int     `json:"certificatesIssued"`
	AverageRating      float64 `json:"averageRating"`
	PendingEvents      int     `json:"pendingEvents"`
}

type CoordinatorDashboard struct {
	Clubs          []Club           `json:"clubs"`
	Stats          CoordinatorStats `json:"stats"`
	PendingMembers []ClubMember     `json:"pendingMembers"`
	UpcomingEvents []Event          `json:"upcomingEvents"`
	RecentFeedback []Feedback       `json:"recentFeedback"`
}

type AdminStats struct {
	TotalUsers             int     `json:"totalUsers"`
	TotalStudents          int     `json:"totalStudents"`
	TotalClubs             int     `json:"totalClubs"`
	ApprovedClubs          int     `json:"approvedClubs"`
	PendingClubs           int     `json:"pendingClubs"`
	TotalEvents            int     `json:"totalEvents"`
	PublishedEvents        int     `json:"publishedEvents"`
	PendingEvents          int     `json:"pendingEvents"`
	ConfirmedRegistrations int     `json:"confirmedRegistrations"`
	CertificatesIssued     int     `json:"certificatesIssued"`
	AverageFeedbackRating  float64 `json:"averageFeedbackRating"`
	TotalDepartments       int     `json:"totalDepartments"`
	TotalVenues            int     `json:"totalVenues"`
}

type ChartPoint struct {
	Label string  `json:"label"`
	Value float64 `json:"value"`
}

type AdminDashboard struct {
	Stats                AdminStats     `json:"stats"`
	PendingClubs         []Club         `json:"pendingClubs"`
	PendingEvents        []Event        `json:"pendingEvents"`
	RecentRegistrations  []Registration `json:"recentRegistrations"`
	RegistrationsByMonth []ChartPoint   `json:"registrationsByMonth"`
	MembersByClub        []ChartPoint   `json:"membersByClub"`
	FeedbackDistribution []ChartPoint   `json:"feedbackDistribution"`
}
