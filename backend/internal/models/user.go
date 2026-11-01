package models

import "time"

type User struct {
	UserID    int64     `json:"userId"`
	Email     string    `json:"email"`
	Role      string    `json:"role"`
	IsActive  bool      `json:"isActive"`
	CreatedAt time.Time `json:"createdAt"`
	Student   *Student  `json:"student,omitempty"`
}

type Student struct {
	StudentID        int64     `json:"studentId"`
	UserID           int64     `json:"userId"`
	Email            string    `json:"email"`
	FullName         string    `json:"fullName"`
	EnrollmentNumber string    `json:"enrollmentNumber"`
	DepartmentID     int64     `json:"departmentId"`
	DepartmentName   string    `json:"departmentName"`
	IsActive         bool      `json:"isActive"`
	CreatedAt        time.Time `json:"createdAt"`
}

type Department struct {
	DepartmentID int64     `json:"departmentId"`
	Name         string    `json:"name"`
	Code         string    `json:"code"`
	StudentCount int       `json:"studentCount"`
	CreatedAt    time.Time `json:"createdAt"`
}

type SessionUser struct {
	User
	CSRFToken string `json:"csrfToken,omitempty"`
}
