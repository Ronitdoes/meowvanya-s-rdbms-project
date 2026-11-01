package services

import (
	"context"
	"errors"
	"log/slog"

	"github.com/campusconnect/backend/internal/apperr"
	"github.com/campusconnect/backend/internal/authctx"
	"github.com/campusconnect/backend/internal/models"
	"github.com/campusconnect/backend/internal/repositories"
	"github.com/jackc/pgx/v5"
)

// RegistrationService owns student registration, cancellation, attendance and
// certificate access rules.
type RegistrationService struct {
	events        *repositories.EventRepository
	registrations *repositories.RegistrationRepository
	authz         *repositories.Authz
}

func NewRegistrationService(
	events *repositories.EventRepository,
	registrations *repositories.RegistrationRepository,
	authz *repositories.Authz,
) *RegistrationService {
	return &RegistrationService{events: events, registrations: registrations, authz: authz}
}

// Register enrols the caller in a published event using the capacity-safe
// repository transaction.
func (s *RegistrationService) Register(ctx context.Context, principal authctx.Principal, eventID int64) (models.Registration, error) {
	studentID, err := eventStudentID(principal)
	if err != nil {
		return models.Registration{}, err
	}
	registrationID, err := s.registrations.Register(ctx, studentID, eventID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.Registration{}, apperr.NotFound("Event not found.")
		}
		return models.Registration{}, registrationStoreError("register for event", err)
	}
	registration, err := s.registrations.Get(ctx, registrationID)
	if err != nil {
		return models.Registration{}, registrationStoreError("load registration", err)
	}
	return registration, nil
}

// MarkAttendance upserts a single registration's attendance row.
func (s *RegistrationService) MarkAttendance(ctx context.Context, principal authctx.Principal, registrationID int64, status string) (models.Attendance, error) {
	if status != "present" && status != "absent" {
		return models.Attendance{}, apperr.Validation(map[string]string{
			"status": "Status must be present or absent.",
		})
	}

	registration, err := s.registrations.Get(ctx, registrationID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.Attendance{}, apperr.NotFound("Registration not found.")
		}
		return models.Attendance{}, registrationStoreError("load registration", err)
	}
	event, err := s.events.GetByID(ctx, registration.EventID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.Attendance{}, apperr.NotFound("Event not found.")
		}
		return models.Attendance{}, registrationStoreError("load attendance event", err)
	}
	if err := eventRequireManager(ctx, s.authz, principal, event); err != nil {
		return models.Attendance{}, err
	}
	if registration.Status != "confirmed" {
		return models.Attendance{}, apperr.Unprocessable("Attendance can only be marked for confirmed registrations.")
	}

	attendance, err := s.registrations.UpsertAttendance(ctx, registrationID, status, principal.UserID)
	if err != nil {
		return models.Attendance{}, registrationStoreError("mark attendance", err)
	}
	return attendance, nil
}

// CancelRegistration lets the owner or an admin cancel a confirmed
// registration that has no attendance record.
func (s *RegistrationService) CancelRegistration(ctx context.Context, principal authctx.Principal, registrationID int64) error {
	registration, err := s.registrations.Get(ctx, registrationID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return apperr.NotFound("Registration not found.")
		}
		return registrationStoreError("load registration", err)
	}

	if !principal.IsAdmin() {
		if principal.StudentID == nil || *principal.StudentID != registration.StudentID {
			return apperr.Forbidden("You can only cancel your own registration.")
		}
	}
	if registration.Status != "confirmed" {
		return apperr.Conflict("Only confirmed registrations can be cancelled.")
	}

	hasAttendance, err := s.registrations.HasAttendance(ctx, registrationID)
	if err != nil {
		return registrationStoreError("check registration attendance", err)
	}
	if hasAttendance {
		return apperr.Conflict("Attendance has already been recorded; this registration cannot be cancelled.")
	}

	if err := s.registrations.Cancel(ctx, registrationID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return apperr.Conflict("This registration could not be cancelled.")
		}
		return registrationStoreError("cancel registration", err)
	}
	return nil
}

// StudentCertificates returns a student's certificates to the owner, an admin,
// or a coordinator of a club the student belongs to.
func (s *RegistrationService) StudentCertificates(ctx context.Context, principal authctx.Principal, studentID int64) ([]models.Certificate, error) {
	exists, err := s.registrations.StudentExists(ctx, studentID)
	if err != nil {
		return nil, registrationStoreError("check student", err)
	}
	if !exists {
		return nil, apperr.NotFound("Student not found.")
	}

	allowed := principal.IsAdmin() ||
		(principal.StudentID != nil && *principal.StudentID == studentID)
	if !allowed {
		if !principal.IsCoordinator() {
			return nil, apperr.Forbidden("You do not have permission to view these certificates.")
		}
		allowed, err = s.authz.CoordinatesStudentClub(ctx, principal.UserID, studentID)
		if err != nil {
			return nil, registrationStoreError("check student's club coordinator", err)
		}
		if !allowed {
			return nil, apperr.Forbidden("You do not have permission to view these certificates.")
		}
	}

	certificates, err := s.registrations.ListStudentCertificates(ctx, studentID)
	if err != nil {
		return nil, registrationStoreError("list student certificates", err)
	}
	return certificates, nil
}

func (s *RegistrationService) MyRegistrations(ctx context.Context, principal authctx.Principal, status string, pageSize, offset int) ([]models.Registration, int, error) {
	studentID, err := eventStudentID(principal)
	if err != nil {
		return nil, 0, err
	}
	registrations, total, err := s.registrations.ListByStudent(ctx, studentID, status, pageSize, offset)
	if err != nil {
		return nil, 0, registrationStoreError("list my registrations", err)
	}
	return registrations, total, nil
}

func (s *RegistrationService) MyCertificates(ctx context.Context, principal authctx.Principal) ([]models.Certificate, error) {
	studentID, err := eventStudentID(principal)
	if err != nil {
		return nil, err
	}
	certificates, err := s.registrations.ListStudentCertificates(ctx, studentID)
	if err != nil {
		return nil, registrationStoreError("list my certificates", err)
	}
	return certificates, nil
}

func registrationStoreError(action string, err error) error {
	if appErr, ok := apperr.As(err); ok {
		return appErr
	}
	slog.Error("registration service: "+action, "error", err)
	return apperr.Internal(err)
}
