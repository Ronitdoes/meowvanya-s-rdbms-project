package services

import (
	"context"
	"errors"
	"log/slog"
	"strings"

	"github.com/campusconnect/backend/internal/apperr"
	"github.com/campusconnect/backend/internal/auth"
	"github.com/campusconnect/backend/internal/authctx"
	"github.com/campusconnect/backend/internal/models"
	"github.com/campusconnect/backend/internal/repositories"
	"github.com/jackc/pgx/v5"
)

// AuthService owns registration, sign-in, profile and credential rules.
type AuthService struct {
	users *repositories.UserRepository
}

func NewAuthService(users *repositories.UserRepository) *AuthService {
	return &AuthService{users: users}
}

type RegisterInput struct {
	Email            string
	Password         string
	FullName         string
	EnrollmentNumber string
	DepartmentID     int64
}

type LoginInput struct {
	Email    string
	Password string
}

type UpdateProfileInput struct {
	FullName     *string
	DepartmentID *int64
}

type ChangePasswordInput struct {
	CurrentPassword string
	NewPassword     string
}

func (s *AuthService) Register(ctx context.Context, in RegisterInput) (models.SessionUser, error) {
	passwordHash, err := auth.HashPassword(in.Password)
	if err != nil {
		return models.SessionUser{}, authInternalError("hash password", err)
	}

	user, err := s.users.CreateStudent(ctx, repositories.RegisterUserParams{
		Email:            in.Email,
		PasswordHash:     passwordHash,
		FullName:         in.FullName,
		EnrollmentNumber: in.EnrollmentNumber,
		DepartmentID:     in.DepartmentID,
	})
	if err != nil {
		return models.SessionUser{}, authStoreError("register student", err)
	}
	return models.SessionUser{User: user}, nil
}

func (s *AuthService) Login(ctx context.Context, in LoginInput) (models.SessionUser, error) {
	account, err := s.users.FindByEmail(ctx, in.Email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.SessionUser{}, apperr.Unauthorized("Invalid email or password.")
		}
		return models.SessionUser{}, authStoreError("find account", err)
	}

	// A single generic response avoids revealing whether the email exists or
	// whether the account has been deactivated.
	if !auth.CheckPassword(account.PasswordHash, in.Password) || !account.User.IsActive {
		return models.SessionUser{}, apperr.Unauthorized("Invalid email or password.")
	}
	return models.SessionUser{User: account.User}, nil
}

func (s *AuthService) Session(ctx context.Context, userID int64) (models.SessionUser, error) {
	user, err := s.users.FindByID(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.SessionUser{}, apperr.Unauthorized("Your session is no longer valid. Please sign in again.")
		}
		return models.SessionUser{}, authStoreError("load session user", err)
	}
	return models.SessionUser{User: user}, nil
}

func (s *AuthService) UpdateProfile(ctx context.Context, principal authctx.Principal, in UpdateProfileInput) (models.SessionUser, error) {
	if principal.StudentID == nil {
		return models.SessionUser{}, apperr.Forbidden("A student profile is required for this action.")
	}

	params := repositories.UpdateStudentProfileParams{}
	if in.FullName != nil {
		fullName := strings.TrimSpace(*in.FullName)
		if fullName == "" {
			return models.SessionUser{}, apperr.Validation(map[string]string{
				"fullName": "Full name cannot be blank.",
			})
		}
		params.FullName = &fullName
	}
	if in.DepartmentID != nil {
		if *in.DepartmentID <= 0 {
			return models.SessionUser{}, apperr.Validation(map[string]string{
				"departmentId": "Select an existing department.",
			})
		}
		if _, err := s.users.DepartmentName(ctx, *in.DepartmentID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return models.SessionUser{}, apperr.Validation(map[string]string{
					"departmentId": "Select an existing department.",
				})
			}
			return models.SessionUser{}, authStoreError("verify department", err)
		}
		params.DepartmentID = in.DepartmentID
	}
	if params.FullName == nil && params.DepartmentID == nil {
		return models.SessionUser{}, apperr.BadRequest("Provide at least one field to update.")
	}

	if err := s.users.UpdateStudentProfile(ctx, principal.UserID, params); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.SessionUser{}, apperr.Forbidden("A student profile is required for this action.")
		}
		return models.SessionUser{}, authStoreError("update student profile", err)
	}
	return s.Session(ctx, principal.UserID)
}

func (s *AuthService) ChangePassword(ctx context.Context, userID int64, in ChangePasswordInput) error {
	currentHash, err := s.users.PasswordHash(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return apperr.Unauthorized("Your session is no longer valid. Please sign in again.")
		}
		return authStoreError("load password hash", err)
	}
	if !auth.CheckPassword(currentHash, in.CurrentPassword) {
		return apperr.Validation(map[string]string{
			"currentPassword": "Current password is incorrect.",
		})
	}
	if in.NewPassword == in.CurrentPassword {
		return apperr.Validation(map[string]string{
			"newPassword": "New password must be different from the current password.",
		})
	}

	passwordHash, err := auth.HashPassword(in.NewPassword)
	if err != nil {
		return authInternalError("hash new password", err)
	}
	if err := s.users.UpdatePassword(ctx, userID, passwordHash); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return apperr.Unauthorized("Your session is no longer valid. Please sign in again.")
		}
		return authStoreError("update password", err)
	}
	return nil
}

// authStoreError preserves safe application errors and wraps database failures
// so handlers never leak internal details.
func authStoreError(action string, err error) error {
	if appErr, ok := apperr.As(err); ok {
		return appErr
	}
	slog.Error("auth service: "+action, "error", err)
	return apperr.Internal(err)
}

func authInternalError(action string, err error) error {
	slog.Error("auth service: "+action, "error", err)
	return apperr.Internal(err)
}
