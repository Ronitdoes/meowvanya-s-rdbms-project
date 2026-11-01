package services

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/campusconnect/backend/internal/apperr"
	"github.com/campusconnect/backend/internal/auth"
	"github.com/campusconnect/backend/internal/authctx"
	"github.com/campusconnect/backend/internal/models"
	"github.com/campusconnect/backend/internal/repositories"
	"github.com/jackc/pgx/v5"
)

// AdminService owns the business rules for directory and administration routes.
type AdminService struct {
	repo *repositories.AdminRepository
}

func NewAdminService(repo *repositories.AdminRepository) *AdminService {
	return &AdminService{repo: repo}
}

var (
	adminUserRoles = map[string]struct{}{
		"student": {}, "coordinator": {}, "admin": {},
	}
	adminClubStatuses = map[string]struct{}{
		"pending": {}, "approved": {}, "rejected": {}, "inactive": {},
	}
	adminEventStatuses = map[string]struct{}{
		"draft": {}, "pending": {}, "published": {}, "rejected": {}, "completed": {}, "cancelled": {},
	}
	// Admin-driven event approval workflow.
	adminEventTransitions = map[string]map[string]struct{}{
		"pending":   {"published": {}, "rejected": {}},
		"published": {"completed": {}, "cancelled": {}},
		"rejected":  {"pending": {}},
	}
)

// ---------------------------------------------------------------------------
// Directory
// ---------------------------------------------------------------------------

func (s *AdminService) ListDepartments(ctx context.Context) ([]models.Department, error) {
	departments, err := s.repo.ListDepartments(ctx)
	if err != nil {
		return nil, adminStoreError("list departments", err)
	}
	return departments, nil
}

func (s *AdminService) ListVenues(ctx context.Context) ([]models.Venue, error) {
	venues, err := s.repo.ListVenues(ctx)
	if err != nil {
		return nil, adminStoreError("list venues", err)
	}
	return venues, nil
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

func (s *AdminService) Dashboard(ctx context.Context) (models.AdminDashboard, error) {
	stats, err := s.repo.DashboardStats(ctx)
	if err != nil {
		return models.AdminDashboard{}, adminStoreError("load dashboard stats", err)
	}
	pendingClubs, err := s.repo.PendingClubs(ctx)
	if err != nil {
		return models.AdminDashboard{}, adminStoreError("load pending clubs", err)
	}
	pendingEvents, err := s.repo.PendingEvents(ctx, 20)
	if err != nil {
		return models.AdminDashboard{}, adminStoreError("load pending events", err)
	}
	recentRegistrations, err := s.repo.RecentRegistrations(ctx, 8)
	if err != nil {
		return models.AdminDashboard{}, adminStoreError("load recent registrations", err)
	}
	registrationsByMonth, err := s.repo.RegistrationsByMonth(ctx, 6)
	if err != nil {
		return models.AdminDashboard{}, adminStoreError("load registrations by month", err)
	}
	membersByClub, err := s.repo.MembersByClub(ctx, 8)
	if err != nil {
		return models.AdminDashboard{}, adminStoreError("load members by club", err)
	}
	feedbackDistribution, err := s.repo.FeedbackDistribution(ctx)
	if err != nil {
		return models.AdminDashboard{}, adminStoreError("load feedback distribution", err)
	}

	return models.AdminDashboard{
		Stats:                stats,
		PendingClubs:         pendingClubs,
		PendingEvents:        pendingEvents,
		RecentRegistrations:  recentRegistrations,
		RegistrationsByMonth: registrationsByMonth,
		MembersByClub:        membersByClub,
		FeedbackDistribution: feedbackDistribution,
	}, nil
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

type AdminUserListInput struct {
	Search string
	Role   string
	Limit  int
	Offset int
}

func (s *AdminService) ListUsers(ctx context.Context, in AdminUserListInput) ([]models.User, int, error) {
	role := strings.ToLower(strings.TrimSpace(in.Role))
	if role != "" {
		if _, ok := adminUserRoles[role]; !ok {
			return nil, 0, apperr.BadRequest("Role filter must be one of student, coordinator or admin.")
		}
	}
	users, total, err := s.repo.ListUsers(ctx, repositories.AdminUserListParams{
		Search: strings.TrimSpace(in.Search),
		Role:   role,
		Limit:  in.Limit,
		Offset: in.Offset,
	})
	if err != nil {
		return nil, 0, adminStoreError("list users", err)
	}
	return users, total, nil
}

type AdminUpdateUserInput struct {
	IsActive *bool
	Role     *string
}

func (s *AdminService) UpdateUser(ctx context.Context, principal authctx.Principal, userID int64, in AdminUpdateUserInput) (models.User, error) {
	if in.IsActive == nil && in.Role == nil {
		return models.User{}, apperr.BadRequest("Provide at least one field to update.")
	}
	if in.Role != nil {
		role := strings.ToLower(strings.TrimSpace(*in.Role))
		if _, ok := adminUserRoles[role]; !ok {
			return models.User{}, apperr.Validation(map[string]string{
				"role": "Choose student, coordinator or admin.",
			})
		}
		in.Role = &role
	}

	current, err := s.repo.FindUserByID(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.User{}, apperr.NotFound("User not found.")
		}
		return models.User{}, adminStoreError("load user", err)
	}

	if userID == principal.UserID {
		if in.IsActive != nil && !*in.IsActive {
			return models.User{}, apperr.Conflict("You cannot deactivate your own account.")
		}
		if in.Role != nil && *in.Role != "admin" {
			return models.User{}, apperr.Conflict("You cannot change your own admin role.")
		}
	}

	// Student and coordinator accounts need a student profile to stay consistent.
	if in.Role != nil && (*in.Role == "student" || *in.Role == "coordinator") && current.Student == nil {
		return models.User{}, apperr.Conflict("This account has no student profile and cannot take that role.")
	}

	updated, err := s.repo.UpdateUser(ctx, userID, in.IsActive, in.Role)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.User{}, apperr.NotFound("User not found.")
		}
		return models.User{}, adminStoreError("update user", err)
	}
	return updated, nil
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

type AdminStudentListInput struct {
	Search       string
	DepartmentID int64
	Limit        int
	Offset       int
}

func (s *AdminService) ListStudents(ctx context.Context, in AdminStudentListInput) ([]models.Student, int, error) {
	students, total, err := s.repo.ListStudents(ctx, repositories.AdminStudentListParams{
		Search:       strings.TrimSpace(in.Search),
		DepartmentID: in.DepartmentID,
		Limit:        in.Limit,
		Offset:       in.Offset,
	})
	if err != nil {
		return nil, 0, adminStoreError("list students", err)
	}
	return students, total, nil
}

type AdminCreateStudentInput struct {
	Email            string
	Password         string
	FullName         string
	EnrollmentNumber string
	DepartmentID     int64
	Role             string
}

func (s *AdminService) CreateStudent(ctx context.Context, in AdminCreateStudentInput) (models.Student, error) {
	role := strings.ToLower(strings.TrimSpace(in.Role))
	if role == "" {
		role = "student"
	}
	if role != "student" && role != "coordinator" {
		return models.Student{}, apperr.Validation(map[string]string{
			"role": "Role must be student or coordinator.",
		})
	}

	exists, err := s.repo.DepartmentExists(ctx, in.DepartmentID)
	if err != nil {
		return models.Student{}, adminStoreError("verify department", err)
	}
	if !exists {
		return models.Student{}, apperr.Validation(map[string]string{
			"departmentId": "Select an existing department.",
		})
	}

	passwordHash, err := auth.HashPassword(in.Password)
	if err != nil {
		slog.Error("admin service: hash password", "error", err)
		return models.Student{}, apperr.Internal(err)
	}

	student, err := s.repo.CreateStudent(ctx, repositories.AdminCreateStudentParams{
		Email:            in.Email,
		PasswordHash:     passwordHash,
		FullName:         in.FullName,
		EnrollmentNumber: in.EnrollmentNumber,
		DepartmentID:     in.DepartmentID,
		Role:             role,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.Student{}, apperr.Validation(map[string]string{
				"departmentId": "Select an existing department.",
			})
		}
		return models.Student{}, adminStoreError("create student", err)
	}
	return student, nil
}

type AdminUpdateStudentInput struct {
	FullName         *string
	DepartmentID     *int64
	EnrollmentNumber *string
}

func (s *AdminService) UpdateStudent(ctx context.Context, studentID int64, in AdminUpdateStudentInput) (models.Student, error) {
	if in.FullName == nil && in.DepartmentID == nil && in.EnrollmentNumber == nil {
		return models.Student{}, apperr.BadRequest("Provide at least one field to update.")
	}
	if in.DepartmentID != nil {
		exists, err := s.repo.DepartmentExists(ctx, *in.DepartmentID)
		if err != nil {
			return models.Student{}, adminStoreError("verify department", err)
		}
		if !exists {
			return models.Student{}, apperr.Validation(map[string]string{
				"departmentId": "Select an existing department.",
			})
		}
	}

	student, err := s.repo.UpdateStudent(ctx, studentID, in.FullName, in.DepartmentID, in.EnrollmentNumber)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.Student{}, apperr.NotFound("Student not found.")
		}
		return models.Student{}, adminStoreError("update student", err)
	}
	return student, nil
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

func (s *AdminService) CreateDepartment(ctx context.Context, name, code string) (models.Department, error) {
	department, err := s.repo.CreateDepartment(ctx, name, code)
	if err != nil {
		return models.Department{}, adminStoreError("create department", err)
	}
	return department, nil
}

type AdminUpdateDepartmentInput struct {
	Name *string
	Code *string
}

func (s *AdminService) UpdateDepartment(ctx context.Context, departmentID int64, in AdminUpdateDepartmentInput) (models.Department, error) {
	if in.Name == nil && in.Code == nil {
		return models.Department{}, apperr.BadRequest("Provide at least one field to update.")
	}
	department, err := s.repo.UpdateDepartment(ctx, departmentID, in.Name, in.Code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.Department{}, apperr.NotFound("Department not found.")
		}
		return models.Department{}, adminStoreError("update department", err)
	}
	return department, nil
}

func (s *AdminService) DeleteDepartment(ctx context.Context, departmentID int64) error {
	if err := s.repo.DeleteDepartment(ctx, departmentID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return apperr.NotFound("Department not found.")
		}
		return adminStoreError("delete department", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Venues
// ---------------------------------------------------------------------------

func (s *AdminService) CreateVenue(ctx context.Context, name string, capacity int, location string) (models.Venue, error) {
	venue, err := s.repo.CreateVenue(ctx, name, capacity, location)
	if err != nil {
		return models.Venue{}, adminStoreError("create venue", err)
	}
	return venue, nil
}

type AdminUpdateVenueInput struct {
	Name     *string
	Capacity *int
	Location *string
}

func (s *AdminService) UpdateVenue(ctx context.Context, venueID int64, in AdminUpdateVenueInput) (models.Venue, error) {
	if in.Name == nil && in.Capacity == nil && in.Location == nil {
		return models.Venue{}, apperr.BadRequest("Provide at least one field to update.")
	}
	if in.Capacity != nil {
		// Existing events must still fit inside the venue after a capacity change.
		maxEventCapacity, err := s.repo.MaxEventCapacity(ctx, venueID)
		if err != nil {
			return models.Venue{}, adminStoreError("load venue event capacity", err)
		}
		if *in.Capacity < maxEventCapacity {
			return models.Venue{}, apperr.Conflict(fmt.Sprintf(
				"Capacity cannot be lower than an existing event's capacity (%d).", maxEventCapacity,
			))
		}
	}

	venue, err := s.repo.UpdateVenue(ctx, venueID, in.Name, in.Capacity, in.Location)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.Venue{}, apperr.NotFound("Venue not found.")
		}
		return models.Venue{}, adminStoreError("update venue", err)
	}
	return venue, nil
}

func (s *AdminService) DeleteVenue(ctx context.Context, venueID int64) error {
	if err := s.repo.DeleteVenue(ctx, venueID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return apperr.NotFound("Venue not found.")
		}
		return adminStoreError("delete venue", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Clubs
// ---------------------------------------------------------------------------

type AdminClubListInput struct {
	Status string
	Search string
	Limit  int
	Offset int
}

func (s *AdminService) ListClubs(ctx context.Context, in AdminClubListInput) ([]models.Club, int, error) {
	status := strings.ToLower(strings.TrimSpace(in.Status))
	if status != "" {
		if _, ok := adminClubStatuses[status]; !ok {
			return nil, 0, apperr.BadRequest("Status filter must be pending, approved, rejected or inactive.")
		}
	}
	clubs, total, err := s.repo.ListClubs(ctx, repositories.AdminClubListParams{
		Status: status,
		Search: strings.TrimSpace(in.Search),
		Limit:  in.Limit,
		Offset: in.Offset,
	})
	if err != nil {
		return nil, 0, adminStoreError("list clubs", err)
	}
	return clubs, total, nil
}

type AdminCreateClubInput struct {
	Name        string
	Description string
	Status      string
}

func (s *AdminService) CreateClub(ctx context.Context, in AdminCreateClubInput) (models.Club, error) {
	status := strings.ToLower(strings.TrimSpace(in.Status))
	if status == "" {
		status = "pending"
	}
	if _, ok := adminClubStatuses[status]; !ok {
		return models.Club{}, apperr.Validation(map[string]string{
			"status": "Choose a valid club status.",
		})
	}
	club, err := s.repo.CreateClub(ctx, strings.TrimSpace(in.Name), strings.TrimSpace(in.Description), status)
	if err != nil {
		return models.Club{}, adminStoreError("create club", err)
	}
	return club, nil
}

type AdminUpdateClubInput struct {
	Name        *string
	Description *string
	Status      *string
}

func (s *AdminService) UpdateClub(ctx context.Context, clubID int64, in AdminUpdateClubInput) (models.Club, error) {
	if in.Name == nil && in.Description == nil && in.Status == nil {
		return models.Club{}, apperr.BadRequest("Provide at least one field to update.")
	}
	if in.Status != nil {
		status := strings.ToLower(strings.TrimSpace(*in.Status))
		if _, ok := adminClubStatuses[status]; !ok {
			return models.Club{}, apperr.Validation(map[string]string{
				"status": "Choose a valid club status.",
			})
		}
		in.Status = &status
	}
	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		in.Name = &name
	}
	if in.Description != nil {
		description := strings.TrimSpace(*in.Description)
		in.Description = &description
	}

	club, err := s.repo.UpdateClub(ctx, clubID, in.Name, in.Description, in.Status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.Club{}, apperr.NotFound("Club not found.")
		}
		return models.Club{}, adminStoreError("update club", err)
	}
	return club, nil
}

func (s *AdminService) SetClubCoordinator(ctx context.Context, clubID, studentID, adminID int64) (models.Club, error) {
	if _, err := s.repo.GetClub(ctx, clubID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.Club{}, apperr.NotFound("Club not found.")
		}
		return models.Club{}, adminStoreError("load club", err)
	}
	if _, err := s.repo.FindStudentByID(ctx, studentID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.Club{}, apperr.NotFound("Student not found.")
		}
		return models.Club{}, adminStoreError("load student", err)
	}
	if err := s.repo.SetClubCoordinator(ctx, clubID, studentID, adminID); err != nil {
		return models.Club{}, adminStoreError("set club coordinator", err)
	}
	club, err := s.repo.GetClub(ctx, clubID)
	if err != nil {
		return models.Club{}, adminStoreError("reload club", err)
	}
	return club, nil
}

func (s *AdminService) DeleteClub(ctx context.Context, clubID int64) error {
	if err := s.repo.DeleteClub(ctx, clubID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return apperr.NotFound("Club not found.")
		}
		return adminStoreError("delete club", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

type AdminEventListInput struct {
	Status string
	Search string
	Limit  int
	Offset int
}

func (s *AdminService) ListEvents(ctx context.Context, in AdminEventListInput) ([]models.Event, int, error) {
	status := strings.ToLower(strings.TrimSpace(in.Status))
	if status != "" {
		if _, ok := adminEventStatuses[status]; !ok {
			return nil, 0, apperr.BadRequest("Status filter is not a valid event status.")
		}
	}
	events, total, err := s.repo.ListEvents(ctx, repositories.AdminEventListParams{
		Status: status,
		Search: strings.TrimSpace(in.Search),
		Limit:  in.Limit,
		Offset: in.Offset,
	})
	if err != nil {
		return nil, 0, adminStoreError("list events", err)
	}
	return events, total, nil
}

type AdminUpdateEventStatusInput struct {
	Status          string
	RejectionReason *string
}

func (s *AdminService) UpdateEventStatus(ctx context.Context, eventID int64, in AdminUpdateEventStatusInput) (models.Event, error) {
	status := strings.ToLower(strings.TrimSpace(in.Status))
	if _, ok := adminEventStatuses[status]; !ok {
		return models.Event{}, apperr.Validation(map[string]string{
			"status": "Choose a valid event status.",
		})
	}

	current, err := s.repo.GetEvent(ctx, eventID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.Event{}, apperr.NotFound("Event not found.")
		}
		return models.Event{}, adminStoreError("load event", err)
	}

	allowed, ok := adminEventTransitions[current.Status]
	if !ok {
		return models.Event{}, apperr.Conflict(fmt.Sprintf(
			"An event with status %q cannot change status.", current.Status,
		))
	}
	if _, ok := allowed[status]; !ok {
		return models.Event{}, apperr.Conflict(fmt.Sprintf(
			"An event with status %q cannot move to %q.", current.Status, status,
		))
	}

	var reason *string
	if status == "rejected" && in.RejectionReason != nil {
		trimmed := strings.TrimSpace(*in.RejectionReason)
		if trimmed != "" {
			reason = &trimmed
		}
	}

	event, err := s.repo.UpdateEventStatus(ctx, eventID, status, reason)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.Event{}, apperr.NotFound("Event not found.")
		}
		return models.Event{}, adminStoreError("update event status", err)
	}
	return event, nil
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

// adminStoreError preserves transport-safe errors and wraps unexpected storage
// failures so handlers never expose internal details.
func adminStoreError(action string, err error) error {
	if appErr, ok := apperr.As(err); ok {
		return appErr
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.NotFound("The requested record was not found.")
	}
	slog.Error("admin service: "+action, "error", err)
	return apperr.Internal(err)
}
