package repositories

import (
	"context"
	"errors"
	"time"

	"github.com/campusconnect/backend/internal/apperr"
	"github.com/campusconnect/backend/internal/models"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// UserRepository owns account and student-profile persistence.
type UserRepository struct {
	db *pgxpool.Pool
}

func NewUserRepository(db *pgxpool.Pool) *UserRepository {
	return &UserRepository{db: db}
}

// AuthAccount carries the credential fields required for sign-in.
type AuthAccount struct {
	User         models.User
	PasswordHash string
}

type RegisterUserParams struct {
	Email            string
	PasswordHash     string
	FullName         string
	EnrollmentNumber string
	DepartmentID     int64
}

type UpdateStudentProfileParams struct {
	FullName     *string
	DepartmentID *int64
}

// CreateStudent inserts the user and student profile in a single transaction.
func (r *UserRepository) CreateStudent(ctx context.Context, params RegisterUserParams) (models.User, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return models.User{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var departmentName string
	if err := tx.QueryRow(ctx,
		`SELECT name FROM departments WHERE department_id = $1`,
		params.DepartmentID,
	).Scan(&departmentName); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.User{}, apperr.Validation(map[string]string{
				"departmentId": "Select an existing department.",
			})
		}
		return models.User{}, err
	}

	var user models.User
	err = tx.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, role)
		VALUES ($1, $2, 'student')
		RETURNING user_id, email, role, is_active, created_at
	`, params.Email, params.PasswordHash).Scan(
		&user.UserID,
		&user.Email,
		&user.Role,
		&user.IsActive,
		&user.CreatedAt,
	)
	if err != nil {
		return models.User{}, mapUserWriteError(err)
	}

	var (
		studentID        int64
		fullName         string
		enrollmentNumber string
		departmentID     int64
		studentCreatedAt time.Time
	)
	err = tx.QueryRow(ctx, `
		INSERT INTO students (user_id, department_id, full_name, enrollment_number)
		VALUES ($1, $2, $3, $4)
		RETURNING student_id, full_name, enrollment_number, department_id, created_at
	`, user.UserID, params.DepartmentID, params.FullName, params.EnrollmentNumber).Scan(
		&studentID,
		&fullName,
		&enrollmentNumber,
		&departmentID,
		&studentCreatedAt,
	)
	if err != nil {
		return models.User{}, mapUserWriteError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return models.User{}, err
	}

	user.Student = &models.Student{
		StudentID:        studentID,
		UserID:           user.UserID,
		Email:            user.Email,
		FullName:         fullName,
		EnrollmentNumber: enrollmentNumber,
		DepartmentID:     departmentID,
		DepartmentName:   departmentName,
		IsActive:         user.IsActive,
		CreatedAt:        studentCreatedAt,
	}
	return user, nil
}

// FindByEmail loads an account and its optional student profile for sign-in.
func (r *UserRepository) FindByEmail(ctx context.Context, email string) (AuthAccount, error) {
	var (
		account          AuthAccount
		studentID        *int64
		fullName         *string
		enrollmentNumber *string
		departmentID     *int64
		departmentName   *string
		studentCreatedAt *time.Time
	)
	err := r.db.QueryRow(ctx, `
		SELECT u.user_id, u.email, u.role, u.is_active, u.created_at, u.password_hash,
		       s.student_id, s.full_name, s.enrollment_number, s.department_id,
		       d.name, s.created_at
		FROM users u
		LEFT JOIN students s ON s.user_id = u.user_id
		LEFT JOIN departments d ON d.department_id = s.department_id
		WHERE u.email = $1
	`, email).Scan(
		&account.User.UserID,
		&account.User.Email,
		&account.User.Role,
		&account.User.IsActive,
		&account.User.CreatedAt,
		&account.PasswordHash,
		&studentID,
		&fullName,
		&enrollmentNumber,
		&departmentID,
		&departmentName,
		&studentCreatedAt,
	)
	if err != nil {
		return AuthAccount{}, err
	}
	account.User.Student = buildStudent(account.User, studentID, fullName, enrollmentNumber, departmentID, departmentName, studentCreatedAt)
	return account, nil
}

// FindByID loads a user and optional student profile without credential fields.
func (r *UserRepository) FindByID(ctx context.Context, userID int64) (models.User, error) {
	var (
		user             models.User
		studentID        *int64
		fullName         *string
		enrollmentNumber *string
		departmentID     *int64
		departmentName   *string
		studentCreatedAt *time.Time
	)
	err := r.db.QueryRow(ctx, `
		SELECT u.user_id, u.email, u.role, u.is_active, u.created_at,
		       s.student_id, s.full_name, s.enrollment_number, s.department_id,
		       d.name, s.created_at
		FROM users u
		LEFT JOIN students s ON s.user_id = u.user_id
		LEFT JOIN departments d ON d.department_id = s.department_id
		WHERE u.user_id = $1
	`, userID).Scan(
		&user.UserID,
		&user.Email,
		&user.Role,
		&user.IsActive,
		&user.CreatedAt,
		&studentID,
		&fullName,
		&enrollmentNumber,
		&departmentID,
		&departmentName,
		&studentCreatedAt,
	)
	if err != nil {
		return models.User{}, err
	}
	user.Student = buildStudent(user, studentID, fullName, enrollmentNumber, departmentID, departmentName, studentCreatedAt)
	return user, nil
}

func (r *UserRepository) DepartmentName(ctx context.Context, departmentID int64) (string, error) {
	var name string
	err := r.db.QueryRow(ctx,
		`SELECT name FROM departments WHERE department_id = $1`,
		departmentID,
	).Scan(&name)
	return name, err
}

func (r *UserRepository) UpdateStudentProfile(ctx context.Context, userID int64, params UpdateStudentProfileParams) error {
	tag, err := r.db.Exec(ctx, `
		UPDATE students
		SET full_name = COALESCE($2, full_name),
		    department_id = COALESCE($3, department_id),
		    updated_at = CURRENT_TIMESTAMP
		WHERE user_id = $1
	`, userID, params.FullName, params.DepartmentID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *UserRepository) PasswordHash(ctx context.Context, userID int64) (string, error) {
	var hash string
	err := r.db.QueryRow(ctx,
		`SELECT password_hash FROM users WHERE user_id = $1`,
		userID,
	).Scan(&hash)
	return hash, err
}

func (r *UserRepository) UpdatePassword(ctx context.Context, userID int64, passwordHash string) error {
	tag, err := r.db.Exec(ctx, `
		UPDATE users
		SET password_hash = $2, updated_at = CURRENT_TIMESTAMP
		WHERE user_id = $1
	`, userID, passwordHash)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func buildStudent(
	user models.User,
	studentID *int64,
	fullName *string,
	enrollmentNumber *string,
	departmentID *int64,
	departmentName *string,
	createdAt *time.Time,
) *models.Student {
	if studentID == nil {
		return nil
	}
	student := &models.Student{
		StudentID: *studentID,
		UserID:    user.UserID,
		Email:     user.Email,
		IsActive:  user.IsActive,
	}
	if fullName != nil {
		student.FullName = *fullName
	}
	if enrollmentNumber != nil {
		student.EnrollmentNumber = *enrollmentNumber
	}
	if departmentID != nil {
		student.DepartmentID = *departmentID
	}
	if departmentName != nil {
		student.DepartmentName = *departmentName
	}
	if createdAt != nil {
		student.CreatedAt = *createdAt
	}
	return student
}

// mapUserWriteError translates unique and constraint failures into field-level
// validation errors the registration form can display.
func mapUserWriteError(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch pgErr.Code {
	case "23505":
		switch pgErr.ConstraintName {
		case "users_email_unique":
			return apperr.Validation(map[string]string{
				"email": "An account with this email already exists.",
			})
		case "students_enrollment_unique":
			return apperr.Validation(map[string]string{
				"enrollmentNumber": "This enrollment number is already registered.",
			})
		}
		return apperr.Conflict("You are already registered.")
	case "23503":
		if pgErr.ConstraintName == "students_department_fk" {
			return apperr.Validation(map[string]string{
				"departmentId": "Select an existing department.",
			})
		}
		return apperr.Conflict("This record is still referenced and cannot be changed.")
	case "23514":
		switch pgErr.ConstraintName {
		case "users_email_format", "users_email_lowercase":
			return apperr.Validation(map[string]string{
				"email": "Enter a valid email address.",
			})
		case "students_enrollment_format":
			return apperr.Validation(map[string]string{
				"enrollmentNumber": "Enrollment number must be 4-24 letters, numbers or dashes.",
			})
		case "students_full_name_not_blank":
			return apperr.Validation(map[string]string{
				"fullName": "Full name cannot be blank.",
			})
		}
		return apperr.Unprocessable("The operation violates a database rule.")
	case "22P02":
		return apperr.BadRequest("One of the provided values has an invalid format.")
	}
	return err
}
