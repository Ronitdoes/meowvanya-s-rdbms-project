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

// AdminRepository owns the SQL used by the admin and public-directory routes.
// Every statement is parameterized; dynamic filters are fixed fragments whose
// values are always bound as arguments.
type AdminRepository struct {
	db *pgxpool.Pool
}

func NewAdminRepository(db *pgxpool.Pool) *AdminRepository {
	return &AdminRepository{db: db}
}

type adminRowScanner interface {
	Scan(dest ...any) error
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

const adminDepartmentSelect = `
	SELECT d.department_id, d.name, d.code,
	       COUNT(s.student_id)::int AS student_count, d.created_at
	FROM departments d
	LEFT JOIN students s ON s.department_id = d.department_id`

func (r *AdminRepository) ListDepartments(ctx context.Context) ([]models.Department, error) {
	rows, err := r.db.Query(ctx, adminDepartmentSelect+`
		GROUP BY d.department_id
		ORDER BY d.name, d.department_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	departments := make([]models.Department, 0)
	for rows.Next() {
		department, err := scanAdminDepartment(rows)
		if err != nil {
			return nil, err
		}
		departments = append(departments, department)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return departments, nil
}

func (r *AdminRepository) DepartmentExists(ctx context.Context, departmentID int64) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM departments WHERE department_id = $1)`,
		departmentID,
	).Scan(&exists)
	return exists, err
}

func (r *AdminRepository) CreateDepartment(ctx context.Context, name, code string) (models.Department, error) {
	var department models.Department
	err := r.db.QueryRow(ctx, `
		INSERT INTO departments (name, code)
		VALUES ($1, $2)
		RETURNING department_id, name, code, created_at
	`, name, code).Scan(
		&department.DepartmentID,
		&department.Name,
		&department.Code,
		&department.CreatedAt,
	)
	if err != nil {
		return models.Department{}, adminDepartmentWriteError(err)
	}
	return department, nil
}

func (r *AdminRepository) UpdateDepartment(ctx context.Context, departmentID int64, name, code *string) (models.Department, error) {
	var department models.Department
	err := r.db.QueryRow(ctx, `
		WITH updated AS (
			UPDATE departments
			SET name = COALESCE($2, name),
			    code = COALESCE($3, code)
			WHERE department_id = $1
			RETURNING department_id, name, code, created_at
		)
		SELECT u.department_id, u.name, u.code,
		       (SELECT COUNT(*)::int FROM students s WHERE s.department_id = u.department_id),
		       u.created_at
		FROM updated u
	`, departmentID, name, code).Scan(
		&department.DepartmentID,
		&department.Name,
		&department.Code,
		&department.StudentCount,
		&department.CreatedAt,
	)
	if err != nil {
		return models.Department{}, adminDepartmentWriteError(err)
	}
	return department, nil
}

func (r *AdminRepository) DeleteDepartment(ctx context.Context, departmentID int64) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM departments WHERE department_id = $1`, departmentID)
	if err != nil {
		return adminReferenceError(err, "This department still has students and cannot be deleted.")
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func scanAdminDepartment(row adminRowScanner) (models.Department, error) {
	var department models.Department
	err := row.Scan(
		&department.DepartmentID,
		&department.Name,
		&department.Code,
		&department.StudentCount,
		&department.CreatedAt,
	)
	return department, err
}

func adminDepartmentWriteError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.ConstraintName {
		case "departments_name_unique":
			return apperr.Validation(map[string]string{"name": "A department with this name already exists."})
		case "departments_code_unique":
			return apperr.Validation(map[string]string{"code": "A department with this code already exists."})
		case "departments_code_format":
			return apperr.Validation(map[string]string{"code": "Code must be 2-8 uppercase letters."})
		case "departments_name_not_blank":
			return apperr.Validation(map[string]string{"name": "Department name cannot be blank."})
		}
	}
	return err
}

// ---------------------------------------------------------------------------
// Venues
// ---------------------------------------------------------------------------

const adminVenueSelect = `
	SELECT v.venue_id, v.name, v.capacity, v.location,
	       COUNT(e.event_id)::int AS event_count, v.created_at
	FROM venues v
	LEFT JOIN events e ON e.venue_id = v.venue_id`

func (r *AdminRepository) ListVenues(ctx context.Context) ([]models.Venue, error) {
	rows, err := r.db.Query(ctx, adminVenueSelect+`
		GROUP BY v.venue_id
		ORDER BY v.name, v.venue_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	venues := make([]models.Venue, 0)
	for rows.Next() {
		venue, err := scanAdminVenue(rows)
		if err != nil {
			return nil, err
		}
		venues = append(venues, venue)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return venues, nil
}

func (r *AdminRepository) CreateVenue(ctx context.Context, name string, capacity int, location string) (models.Venue, error) {
	var venue models.Venue
	err := r.db.QueryRow(ctx, `
		INSERT INTO venues (name, capacity, location)
		VALUES ($1, $2, $3)
		RETURNING venue_id, name, capacity, location, created_at
	`, name, capacity, location).Scan(
		&venue.VenueID,
		&venue.Name,
		&venue.Capacity,
		&venue.Location,
		&venue.CreatedAt,
	)
	if err != nil {
		return models.Venue{}, adminVenueWriteError(err)
	}
	return venue, nil
}

func (r *AdminRepository) UpdateVenue(ctx context.Context, venueID int64, name *string, capacity *int, location *string) (models.Venue, error) {
	var venue models.Venue
	err := r.db.QueryRow(ctx, `
		WITH updated AS (
			UPDATE venues
			SET name = COALESCE($2, name),
			    capacity = COALESCE($3, capacity),
			    location = COALESCE($4, location)
			WHERE venue_id = $1
			RETURNING venue_id, name, capacity, location, created_at
		)
		SELECT u.venue_id, u.name, u.capacity, u.location,
		       (SELECT COUNT(*)::int FROM events e WHERE e.venue_id = u.venue_id),
		       u.created_at
		FROM updated u
	`, venueID, name, capacity, location).Scan(
		&venue.VenueID,
		&venue.Name,
		&venue.Capacity,
		&venue.Location,
		&venue.EventCount,
		&venue.CreatedAt,
	)
	if err != nil {
		return models.Venue{}, adminVenueWriteError(err)
	}
	return venue, nil
}

// MaxEventCapacity returns the largest capacity among the venue's events.
func (r *AdminRepository) MaxEventCapacity(ctx context.Context, venueID int64) (int, error) {
	var capacity int
	err := r.db.QueryRow(ctx,
		`SELECT COALESCE(MAX(capacity), 0)::int FROM events WHERE venue_id = $1`,
		venueID,
	).Scan(&capacity)
	return capacity, err
}

func (r *AdminRepository) DeleteVenue(ctx context.Context, venueID int64) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM venues WHERE venue_id = $1`, venueID)
	if err != nil {
		return adminReferenceError(err, "This venue still has events and cannot be deleted.")
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func scanAdminVenue(row adminRowScanner) (models.Venue, error) {
	var venue models.Venue
	err := row.Scan(
		&venue.VenueID,
		&venue.Name,
		&venue.Capacity,
		&venue.Location,
		&venue.EventCount,
		&venue.CreatedAt,
	)
	return venue, err
}

func adminVenueWriteError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.ConstraintName {
		case "venues_name_unique":
			return apperr.Validation(map[string]string{"name": "A venue with this name already exists."})
		case "venues_capacity_positive":
			return apperr.Validation(map[string]string{"capacity": "Capacity must be greater than zero."})
		case "venues_location_not_blank":
			return apperr.Validation(map[string]string{"location": "Location cannot be blank."})
		}
	}
	return err
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

func (r *AdminRepository) DashboardStats(ctx context.Context) (models.AdminStats, error) {
	var stats models.AdminStats
	err := r.db.QueryRow(ctx, `
		SELECT ps.total_users,
		       ps.total_students,
		       ps.total_clubs,
		       ps.approved_clubs,
		       (SELECT COUNT(*)::int FROM clubs WHERE status = 'pending'),
		       ps.total_events,
		       ps.published_events,
		       (SELECT COUNT(*)::int FROM events WHERE status = 'pending'),
		       ps.confirmed_registrations,
		       ps.certificates_issued,
		       ps.average_feedback_rating::float8,
		       (SELECT COUNT(*)::int FROM departments),
		       (SELECT COUNT(*)::int FROM venues)
		FROM platform_stats ps
	`).Scan(
		&stats.TotalUsers,
		&stats.TotalStudents,
		&stats.TotalClubs,
		&stats.ApprovedClubs,
		&stats.PendingClubs,
		&stats.TotalEvents,
		&stats.PublishedEvents,
		&stats.PendingEvents,
		&stats.ConfirmedRegistrations,
		&stats.CertificatesIssued,
		&stats.AverageFeedbackRating,
		&stats.TotalDepartments,
		&stats.TotalVenues,
	)
	return stats, err
}

func (r *AdminRepository) RegistrationsByMonth(ctx context.Context, months int) ([]models.ChartPoint, error) {
	rows, err := r.db.Query(ctx, `
		SELECT to_char(m, 'Mon') AS label,
		       COUNT(r.registration_id)::float8 AS value
		FROM generate_series(
		         date_trunc('month', CURRENT_TIMESTAMP) - make_interval(months => ($1 - 1)::int),
		         date_trunc('month', CURRENT_TIMESTAMP),
		         INTERVAL '1 month'
		     ) AS m
		LEFT JOIN registrations r ON date_trunc('month', r.registered_at) = m
		GROUP BY m
		ORDER BY m
	`, months)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	points := make([]models.ChartPoint, 0, months)
	for rows.Next() {
		var point models.ChartPoint
		if err := rows.Scan(&point.Label, &point.Value); err != nil {
			return nil, err
		}
		points = append(points, point)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return points, nil
}

func (r *AdminRepository) MembersByClub(ctx context.Context, limit int) ([]models.ChartPoint, error) {
	rows, err := r.db.Query(ctx, `
		SELECT c.name,
		       COUNT(cm.membership_id) FILTER (WHERE cm.status = 'approved')::float8 AS value
		FROM clubs c
		LEFT JOIN club_members cm ON cm.club_id = c.club_id
		GROUP BY c.club_id, c.name
		ORDER BY value DESC, c.name
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	points := make([]models.ChartPoint, 0, limit)
	for rows.Next() {
		var point models.ChartPoint
		if err := rows.Scan(&point.Label, &point.Value); err != nil {
			return nil, err
		}
		points = append(points, point)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return points, nil
}

func (r *AdminRepository) FeedbackDistribution(ctx context.Context) ([]models.ChartPoint, error) {
	rows, err := r.db.Query(ctx, `
		SELECT g.rating::text || ' star' AS label,
		       COUNT(f.feedback_id)::float8 AS value
		FROM generate_series(1, 5) AS g(rating)
		LEFT JOIN feedback f ON f.rating = g.rating
		GROUP BY g.rating
		ORDER BY g.rating
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	points := make([]models.ChartPoint, 0, 5)
	for rows.Next() {
		var point models.ChartPoint
		if err := rows.Scan(&point.Label, &point.Value); err != nil {
			return nil, err
		}
		points = append(points, point)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return points, nil
}

// ---------------------------------------------------------------------------
// Users and students
// ---------------------------------------------------------------------------

const adminUserSelect = `
	SELECT u.user_id, u.email, u.role, u.is_active, u.created_at,
	       s.student_id, s.full_name, s.enrollment_number, s.department_id,
	       d.name, s.created_at
	FROM users u
	LEFT JOIN students s ON s.user_id = u.user_id
	LEFT JOIN departments d ON d.department_id = s.department_id`

const adminUserWhere = `
	WHERE ($1 = '' OR u.email ILIKE '%' || $1 || '%' OR s.full_name ILIKE '%' || $1 || '%')
	  AND ($2 = '' OR u.role = $2)`

type AdminUserListParams struct {
	Search string
	Role   string
	Limit  int
	Offset int
}

func (r *AdminRepository) ListUsers(ctx context.Context, params AdminUserListParams) ([]models.User, int, error) {
	var total int
	if err := r.db.QueryRow(ctx,
		`SELECT COUNT(*)::int
		 FROM users u
		 LEFT JOIN students s ON s.user_id = u.user_id`+adminUserWhere,
		params.Search, params.Role,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	rows, err := r.db.Query(ctx, adminUserSelect+adminUserWhere+`
		ORDER BY u.created_at DESC, u.user_id DESC
		LIMIT $3 OFFSET $4`,
		params.Search, params.Role, params.Limit, params.Offset,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	users := make([]models.User, 0, params.Limit)
	for rows.Next() {
		user, err := scanAdminUser(rows)
		if err != nil {
			return nil, 0, err
		}
		users = append(users, user)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return users, total, nil
}

func (r *AdminRepository) FindUserByID(ctx context.Context, userID int64) (models.User, error) {
	return scanAdminUser(r.db.QueryRow(ctx, adminUserSelect+` WHERE u.user_id = $1`, userID))
}

func (r *AdminRepository) UpdateUser(ctx context.Context, userID int64, isActive *bool, role *string) (models.User, error) {
	return scanAdminUser(r.db.QueryRow(ctx, `
		WITH updated AS (
			UPDATE users
			SET is_active = COALESCE($2, is_active),
			    role = COALESCE($3, role)
			WHERE user_id = $1
			RETURNING user_id, email, role, is_active, created_at
		)
		SELECT u.user_id, u.email, u.role, u.is_active, u.created_at,
		       s.student_id, s.full_name, s.enrollment_number, s.department_id,
		       d.name, s.created_at
		FROM updated u
		LEFT JOIN students s ON s.user_id = u.user_id
		LEFT JOIN departments d ON d.department_id = s.department_id
	`, userID, isActive, role))
}

const adminStudentSelect = `
	SELECT s.student_id, s.user_id, u.email, s.full_name, s.enrollment_number,
	       s.department_id, d.name, u.is_active, s.created_at
	FROM students s
	JOIN users u ON u.user_id = s.user_id
	JOIN departments d ON d.department_id = s.department_id`

const adminStudentWhere = `
	WHERE ($1 = '' OR u.email ILIKE '%' || $1 || '%'
	       OR s.full_name ILIKE '%' || $1 || '%'
	       OR s.enrollment_number ILIKE '%' || $1 || '%')
	  AND ($2 = 0 OR s.department_id = $2)`

type AdminStudentListParams struct {
	Search       string
	DepartmentID int64
	Limit        int
	Offset       int
}

func (r *AdminRepository) ListStudents(ctx context.Context, params AdminStudentListParams) ([]models.Student, int, error) {
	var total int
	if err := r.db.QueryRow(ctx,
		`SELECT COUNT(*)::int
		 FROM students s
		 JOIN users u ON u.user_id = s.user_id
		 JOIN departments d ON d.department_id = s.department_id`+adminStudentWhere,
		params.Search, params.DepartmentID,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	rows, err := r.db.Query(ctx, adminStudentSelect+adminStudentWhere+`
		ORDER BY s.full_name, s.student_id
		LIMIT $3 OFFSET $4`,
		params.Search, params.DepartmentID, params.Limit, params.Offset,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	students := make([]models.Student, 0, params.Limit)
	for rows.Next() {
		student, err := scanAdminStudent(rows)
		if err != nil {
			return nil, 0, err
		}
		students = append(students, student)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return students, total, nil
}

func (r *AdminRepository) FindStudentByID(ctx context.Context, studentID int64) (models.Student, error) {
	return scanAdminStudent(r.db.QueryRow(ctx, adminStudentSelect+` WHERE s.student_id = $1`, studentID))
}

type AdminCreateStudentParams struct {
	Email            string
	PasswordHash     string
	FullName         string
	EnrollmentNumber string
	DepartmentID     int64
	Role             string
}

// CreateStudent inserts the account and its student profile atomically.
func (r *AdminRepository) CreateStudent(ctx context.Context, params AdminCreateStudentParams) (models.Student, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return models.Student{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var departmentName string
	if err := tx.QueryRow(ctx,
		`SELECT name FROM departments WHERE department_id = $1`,
		params.DepartmentID,
	).Scan(&departmentName); err != nil {
		return models.Student{}, err
	}

	var (
		userID   int64
		email    string
		role     string
		isActive bool
		userMade time.Time
	)
	err = tx.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, role)
		VALUES ($1, $2, $3)
		RETURNING user_id, email, role, is_active, created_at
	`, params.Email, params.PasswordHash, params.Role).Scan(
		&userID, &email, &role, &isActive, &userMade,
	)
	if err != nil {
		return models.Student{}, mapUserWriteError(err)
	}

	var student models.Student
	err = tx.QueryRow(ctx, `
		INSERT INTO students (user_id, department_id, full_name, enrollment_number)
		VALUES ($1, $2, $3, $4)
		RETURNING student_id, full_name, enrollment_number, department_id, created_at
	`, userID, params.DepartmentID, params.FullName, params.EnrollmentNumber).Scan(
		&student.StudentID,
		&student.FullName,
		&student.EnrollmentNumber,
		&student.DepartmentID,
		&student.CreatedAt,
	)
	if err != nil {
		return models.Student{}, mapUserWriteError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return models.Student{}, err
	}

	student.UserID = userID
	student.Email = email
	student.DepartmentName = departmentName
	student.IsActive = isActive
	return student, nil
}

func (r *AdminRepository) UpdateStudent(ctx context.Context, studentID int64, fullName *string, departmentID *int64, enrollmentNumber *string) (models.Student, error) {
	student, err := scanAdminStudent(r.db.QueryRow(ctx, `
		WITH updated AS (
			UPDATE students
			SET full_name = COALESCE($2, full_name),
			    department_id = COALESCE($3, department_id),
			    enrollment_number = COALESCE($4, enrollment_number)
			WHERE student_id = $1
			RETURNING student_id, user_id, full_name, enrollment_number, department_id, created_at
		)
		SELECT s.student_id, s.user_id, u.email, s.full_name, s.enrollment_number,
		       s.department_id, d.name, u.is_active, s.created_at
		FROM updated s
		JOIN users u ON u.user_id = s.user_id
		JOIN departments d ON d.department_id = s.department_id
	`, studentID, fullName, departmentID, enrollmentNumber))
	if err != nil {
		return models.Student{}, mapUserWriteError(err)
	}
	return student, nil
}

func scanAdminUser(row adminRowScanner) (models.User, error) {
	var (
		user           models.User
		studentID      *int64
		fullName       *string
		enrollment     *string
		departmentID   *int64
		departmentName *string
		createdAt      *time.Time
	)
	if err := row.Scan(
		&user.UserID,
		&user.Email,
		&user.Role,
		&user.IsActive,
		&user.CreatedAt,
		&studentID,
		&fullName,
		&enrollment,
		&departmentID,
		&departmentName,
		&createdAt,
	); err != nil {
		return models.User{}, err
	}
	user.Student = buildStudent(user, studentID, fullName, enrollment, departmentID, departmentName, createdAt)
	return user, nil
}

func scanAdminStudent(row adminRowScanner) (models.Student, error) {
	var student models.Student
	err := row.Scan(
		&student.StudentID,
		&student.UserID,
		&student.Email,
		&student.FullName,
		&student.EnrollmentNumber,
		&student.DepartmentID,
		&student.DepartmentName,
		&student.IsActive,
		&student.CreatedAt,
	)
	return student, err
}

// ---------------------------------------------------------------------------
// Clubs
// ---------------------------------------------------------------------------

const adminClubSelect = `
	SELECT c.club_id, c.name, c.description, c.status, c.created_at,
	       COALESCE(cms.approved_members, 0),
	       COALESCE(cms.pending_requests, 0),
	       coord.full_name, coord.email
	FROM clubs c
	LEFT JOIN club_membership_summary cms ON cms.club_id = c.club_id
	LEFT JOIN LATERAL (
		SELECT s.full_name, u.email
		FROM club_members cm
		JOIN students s ON s.student_id = cm.student_id
		JOIN users u ON u.user_id = s.user_id
		WHERE cm.club_id = c.club_id
		  AND cm.role = 'coordinator'
		  AND cm.status = 'approved'
		ORDER BY cm.decided_at NULLS LAST, cm.membership_id
		LIMIT 1
	) coord ON TRUE`

const adminClubWhere = `
	WHERE ($1 = '' OR c.status = $1)
	  AND ($2 = '' OR c.name ILIKE '%' || $2 || '%')`

type AdminClubListParams struct {
	Status string
	Search string
	Limit  int
	Offset int
}

func (r *AdminRepository) ListClubs(ctx context.Context, params AdminClubListParams) ([]models.Club, int, error) {
	var total int
	if err := r.db.QueryRow(ctx,
		`SELECT COUNT(*)::int FROM clubs c`+adminClubWhere,
		params.Status, params.Search,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	rows, err := r.db.Query(ctx, adminClubSelect+adminClubWhere+`
		ORDER BY c.created_at DESC, c.club_id DESC
		LIMIT $3 OFFSET $4`,
		params.Status, params.Search, params.Limit, params.Offset,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	clubs := make([]models.Club, 0, params.Limit)
	for rows.Next() {
		club, err := scanAdminClub(rows)
		if err != nil {
			return nil, 0, err
		}
		clubs = append(clubs, club)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return clubs, total, nil
}

// PendingClubs backs the admin dashboard approval queue.
func (r *AdminRepository) PendingClubs(ctx context.Context) ([]models.Club, error) {
	rows, err := r.db.Query(ctx, adminClubSelect+`
		WHERE c.status = 'pending'
		ORDER BY c.created_at ASC, c.club_id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	clubs := make([]models.Club, 0)
	for rows.Next() {
		club, err := scanAdminClub(rows)
		if err != nil {
			return nil, err
		}
		clubs = append(clubs, club)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return clubs, nil
}

func (r *AdminRepository) GetClub(ctx context.Context, clubID int64) (models.Club, error) {
	return scanAdminClub(r.db.QueryRow(ctx, adminClubSelect+` WHERE c.club_id = $1`, clubID))
}

func (r *AdminRepository) CreateClub(ctx context.Context, name, description, status string) (models.Club, error) {
	var club models.Club
	err := r.db.QueryRow(ctx, `
		INSERT INTO clubs (name, description, status)
		VALUES ($1, $2, $3)
		RETURNING club_id, name, description, status, created_at
	`, name, description, status).Scan(
		&club.ClubID,
		&club.Name,
		&club.Description,
		&club.Status,
		&club.CreatedAt,
	)
	if err != nil {
		return models.Club{}, adminClubWriteError(err)
	}
	return club, nil
}

func (r *AdminRepository) UpdateClub(ctx context.Context, clubID int64, name, description, status *string) (models.Club, error) {
	tag, err := r.db.Exec(ctx, `
		UPDATE clubs
		SET name = COALESCE($2, name),
		    description = COALESCE($3, description),
		    status = COALESCE($4, status)
		WHERE club_id = $1
	`, clubID, name, description, status)
	if err != nil {
		return models.Club{}, adminClubWriteError(err)
	}
	if tag.RowsAffected() == 0 {
		return models.Club{}, pgx.ErrNoRows
	}
	return r.GetClub(ctx, clubID)
}

// SetClubCoordinator upserts an approved coordinator membership, preserving the
// original join date when the student was already an approved member.
func (r *AdminRepository) SetClubCoordinator(ctx context.Context, clubID, studentID, decidedBy int64) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO club_members
			(student_id, club_id, role, status, requested_at, decided_at, decided_by, joined_at)
		VALUES
			($1, $2, 'coordinator', 'approved', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $3, CURRENT_TIMESTAMP)
		ON CONFLICT (student_id, club_id) DO UPDATE
		SET role = 'coordinator',
		    status = 'approved',
		    decided_at = CURRENT_TIMESTAMP,
		    decided_by = EXCLUDED.decided_by,
		    joined_at = COALESCE(club_members.joined_at, CURRENT_TIMESTAMP)
	`, studentID, clubID, decidedBy)
	return err
}

func (r *AdminRepository) DeleteClub(ctx context.Context, clubID int64) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM clubs WHERE club_id = $1`, clubID)
	if err != nil {
		return adminReferenceError(err, "This club still has events and cannot be deleted.")
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func scanAdminClub(row adminRowScanner) (models.Club, error) {
	var club models.Club
	err := row.Scan(
		&club.ClubID,
		&club.Name,
		&club.Description,
		&club.Status,
		&club.CreatedAt,
		&club.ApprovedMembers,
		&club.PendingRequests,
		&club.CoordinatorName,
		&club.CoordinatorEmail,
	)
	return club, err
}

func adminClubWriteError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.ConstraintName {
		case "clubs_name_unique":
			return apperr.Conflict("A club with this name already exists.")
		case "clubs_name_not_blank":
			return apperr.Validation(map[string]string{"name": "Club name cannot be blank."})
		case "clubs_status_check":
			return apperr.Validation(map[string]string{"status": "Choose a valid club status."})
		}
	}
	return err
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const adminEventSelect = `
	SELECT e.event_id, e.club_id, c.name,
	       e.venue_id, v.name, v.capacity,
	       e.created_by, e.title, e.description,
	       e.event_date, e.registration_deadline, e.capacity,
	       e.status, e.rejection_reason, e.created_at, e.updated_at,
	       COALESCE(reg.confirmed, 0), COALESCE(reg.total, 0),
	       e.capacity - COALESCE(reg.confirmed, 0),
	       fb.average_rating, COALESCE(fb.feedback_count, 0)
	FROM events e
	JOIN clubs c ON c.club_id = e.club_id
	JOIN venues v ON v.venue_id = e.venue_id
	LEFT JOIN LATERAL (
		SELECT COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
		       COUNT(*)::int AS total
		FROM registrations r
		WHERE r.event_id = e.event_id
	) reg ON TRUE
	LEFT JOIN LATERAL (
		SELECT ROUND(AVG(rating), 2)::float8 AS average_rating,
		       COUNT(*)::int AS feedback_count
		FROM feedback f
		WHERE f.event_id = e.event_id
	) fb ON TRUE`

const adminEventWhere = `
	WHERE ($1 = '' OR e.status = $1)
	  AND ($2 = '' OR e.title ILIKE '%' || $2 || '%' OR c.name ILIKE '%' || $2 || '%')`

type AdminEventListParams struct {
	Status string
	Search string
	Limit  int
	Offset int
}

func (r *AdminRepository) ListEvents(ctx context.Context, params AdminEventListParams) ([]models.Event, int, error) {
	var total int
	if err := r.db.QueryRow(ctx,
		`SELECT COUNT(*)::int
		 FROM events e
		 JOIN clubs c ON c.club_id = e.club_id`+adminEventWhere,
		params.Status, params.Search,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	rows, err := r.db.Query(ctx, adminEventSelect+adminEventWhere+`
		ORDER BY e.event_date DESC, e.event_id DESC
		LIMIT $3 OFFSET $4`,
		params.Status, params.Search, params.Limit, params.Offset,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	events := make([]models.Event, 0, params.Limit)
	for rows.Next() {
		event, err := scanAdminEvent(rows)
		if err != nil {
			return nil, 0, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return events, total, nil
}

// PendingEvents backs the admin dashboard approval queue.
func (r *AdminRepository) PendingEvents(ctx context.Context, limit int) ([]models.Event, error) {
	rows, err := r.db.Query(ctx, adminEventSelect+`
		WHERE e.status = 'pending'
		ORDER BY e.event_date ASC, e.event_id ASC
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := make([]models.Event, 0)
	for rows.Next() {
		event, err := scanAdminEvent(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return events, nil
}

func (r *AdminRepository) GetEvent(ctx context.Context, eventID int64) (models.Event, error) {
	return scanAdminEvent(r.db.QueryRow(ctx, adminEventSelect+` WHERE e.event_id = $1`, eventID))
}

func (r *AdminRepository) UpdateEventStatus(ctx context.Context, eventID int64, status string, rejectionReason *string) (models.Event, error) {
	tag, err := r.db.Exec(ctx, `
		UPDATE events
		SET status = $2,
		    rejection_reason = $3
		WHERE event_id = $1
	`, eventID, status, rejectionReason)
	if err != nil {
		return models.Event{}, err
	}
	if tag.RowsAffected() == 0 {
		return models.Event{}, pgx.ErrNoRows
	}
	return r.GetEvent(ctx, eventID)
}

func scanAdminEvent(row adminRowScanner) (models.Event, error) {
	var event models.Event
	err := row.Scan(
		&event.EventID,
		&event.ClubID,
		&event.ClubName,
		&event.VenueID,
		&event.VenueName,
		&event.VenueCapacity,
		&event.CreatedBy,
		&event.Title,
		&event.Description,
		&event.EventDate,
		&event.RegistrationDeadline,
		&event.Capacity,
		&event.Status,
		&event.RejectionReason,
		&event.CreatedAt,
		&event.UpdatedAt,
		&event.ConfirmedCount,
		&event.TotalRegistrations,
		&event.SeatsRemaining,
		&event.AverageRating,
		&event.FeedbackCount,
	)
	return event, err
}

// ---------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------

const adminRegistrationSelect = `
	SELECT r.registration_id, r.student_id, r.event_id,
	       s.full_name, u.email, s.enrollment_number, d.name,
	       c.name, e.title, e.event_date, v.name,
	       r.status, r.registered_at, r.cancelled_at,
	       a.attendance_status, cert.certificate_code, cert.certificate_id
	FROM registrations r
	JOIN students s ON s.student_id = r.student_id
	JOIN users u ON u.user_id = s.user_id
	JOIN departments d ON d.department_id = s.department_id
	JOIN events e ON e.event_id = r.event_id
	JOIN clubs c ON c.club_id = e.club_id
	JOIN venues v ON v.venue_id = e.venue_id
	LEFT JOIN attendance a ON a.registration_id = r.registration_id
	LEFT JOIN certificates cert ON cert.registration_id = r.registration_id`

func (r *AdminRepository) RecentRegistrations(ctx context.Context, limit int) ([]models.Registration, error) {
	rows, err := r.db.Query(ctx, adminRegistrationSelect+`
		ORDER BY r.registered_at DESC, r.registration_id DESC
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	registrations := make([]models.Registration, 0, limit)
	for rows.Next() {
		registration, err := scanAdminRegistration(rows)
		if err != nil {
			return nil, err
		}
		registrations = append(registrations, registration)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return registrations, nil
}

func scanAdminRegistration(row adminRowScanner) (models.Registration, error) {
	var registration models.Registration
	err := row.Scan(
		&registration.RegistrationID,
		&registration.StudentID,
		&registration.EventID,
		&registration.StudentName,
		&registration.Email,
		&registration.EnrollmentNumber,
		&registration.DepartmentName,
		&registration.ClubName,
		&registration.EventTitle,
		&registration.EventDate,
		&registration.VenueName,
		&registration.Status,
		&registration.RegisteredAt,
		&registration.CancelledAt,
		&registration.AttendanceStatus,
		&registration.CertificateCode,
		&registration.CertificateID,
	)
	return registration, err
}

// ---------------------------------------------------------------------------
// Shared error mapping
// ---------------------------------------------------------------------------

// adminReferenceError converts a foreign-key restriction into a conflict.
func adminReferenceError(err error, message string) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23503" {
		return apperr.Conflict(message)
	}
	return err
}
