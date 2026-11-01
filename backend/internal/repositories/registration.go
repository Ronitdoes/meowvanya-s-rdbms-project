package repositories

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/campusconnect/backend/internal/apperr"
	"github.com/campusconnect/backend/internal/models"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RegistrationRepository owns registrations, attendance, feedback and
// certificate persistence for the events slice.
type RegistrationRepository struct {
	db *pgxpool.Pool
}

func NewRegistrationRepository(db *pgxpool.Pool) *RegistrationRepository {
	return &RegistrationRepository{db: db}
}

type registrationQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

const registrationSelect = `
	SELECT
		r.registration_id,
		r.student_id,
		r.event_id,
		s.full_name,
		u.email,
		s.enrollment_number,
		d.name,
		c.name,
		e.title,
		e.event_date,
		v.name,
		r.status,
		r.registered_at,
		r.cancelled_at,
		a.attendance_status,
		cert.certificate_code,
		cert.certificate_id
	FROM registrations r
	JOIN students s ON s.student_id = r.student_id
	JOIN users u ON u.user_id = s.user_id
	JOIN departments d ON d.department_id = s.department_id
	JOIN events e ON e.event_id = r.event_id
	JOIN clubs c ON c.club_id = e.club_id
	JOIN venues v ON v.venue_id = e.venue_id
	LEFT JOIN attendance a ON a.registration_id = r.registration_id
	LEFT JOIN certificates cert ON cert.registration_id = r.registration_id`

func scanRegistration(row registrationQuerierRow) (models.Registration, error) {
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

type registrationQuerierRow interface {
	Scan(dest ...any) error
}

func scanRegistrations(rows pgx.Rows) ([]models.Registration, error) {
	registrations := make([]models.Registration, 0)
	for rows.Next() {
		registration, err := scanRegistration(rows)
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

// Register performs the required capacity-safe registration transaction.
func (r *RegistrationRepository) Register(ctx context.Context, studentID, eventID int64) (int64, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var (
		status     string
		capacity   int
		deadlineOK bool
		notStarted bool
	)
	err = tx.QueryRow(ctx, `
		SELECT status,
		       capacity,
		       registration_deadline >= CURRENT_TIMESTAMP,
		       event_date > CURRENT_TIMESTAMP
		FROM events
		WHERE event_id = $1
		FOR UPDATE
	`, eventID).Scan(&status, &capacity, &deadlineOK, &notStarted)
	if err != nil {
		return 0, err
	}

	if status != "published" {
		return 0, apperr.Conflict("Registration for this event is not open.")
	}
	if !deadlineOK || !notStarted {
		return 0, apperr.Conflict("Registration for this event has closed.")
	}

	var confirmed int
	if err := tx.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM registrations
		WHERE event_id = $1 AND status = 'confirmed'
	`, eventID).Scan(&confirmed); err != nil {
		return 0, err
	}
	if confirmed >= capacity {
		return 0, apperr.Conflict("This event is full.")
	}

	var (
		registrationID int64
		existingStatus string
	)
	err = tx.QueryRow(ctx, `
		SELECT registration_id, status
		FROM registrations
		WHERE student_id = $1 AND event_id = $2
	`, studentID, eventID).Scan(&registrationID, &existingStatus)
	switch {
	case err == nil:
		switch existingStatus {
		case "confirmed":
			return 0, apperr.Conflict("You are already registered for this event.")
		case "waitlisted":
			return 0, apperr.Conflict("You are already on the waitlist for this event.")
		case "cancelled":
			err = tx.QueryRow(ctx, `
				UPDATE registrations
				SET status = 'confirmed',
				    registered_at = CURRENT_TIMESTAMP,
				    cancelled_at = NULL
				WHERE registration_id = $1 AND status = 'cancelled'
				RETURNING registration_id
			`, registrationID).Scan(&registrationID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return 0, apperr.Conflict("Your previous registration could not be restored. Please try again.")
				}
				return 0, mapRegistrationWriteError(err, "You could not be registered for this event.")
			}
		default:
			return 0, apperr.Conflict("You already have a registration for this event.")
		}
	case errors.Is(err, pgx.ErrNoRows):
		err = tx.QueryRow(ctx, `
			INSERT INTO registrations (student_id, event_id, status)
			VALUES ($1, $2, 'confirmed')
			RETURNING registration_id
		`, studentID, eventID).Scan(&registrationID)
		if err != nil {
			return 0, mapRegistrationWriteError(err, "You are already registered for this event.")
		}
	default:
		return 0, err
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return registrationID, nil
}

func (r *RegistrationRepository) Get(ctx context.Context, registrationID int64) (models.Registration, error) {
	return scanRegistration(r.db.QueryRow(ctx, registrationSelect+`
		WHERE r.registration_id = $1
	`, registrationID))
}

// ListForEvents returns lightweight registration summaries keyed by event for
// the authenticated student, so public event responses can attach
// myRegistration.
func (r *RegistrationRepository) ListForEvents(ctx context.Context, studentID int64, eventIDs []int64) (map[int64]models.RegistrationSummary, error) {
	summaries := make(map[int64]models.RegistrationSummary)
	if len(eventIDs) == 0 {
		return summaries, nil
	}

	rows, err := r.db.Query(ctx, `
		SELECT r.event_id, r.registration_id, r.status, r.registered_at,
		       r.cancelled_at, a.attendance_status, cert.certificate_code
		FROM registrations r
		LEFT JOIN attendance a ON a.registration_id = r.registration_id
		LEFT JOIN certificates cert ON cert.registration_id = r.registration_id
		WHERE r.student_id = $1 AND r.event_id = ANY($2::BIGINT[])
	`, studentID, eventIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var (
			eventID int64
			summary models.RegistrationSummary
		)
		if err := rows.Scan(
			&eventID,
			&summary.RegistrationID,
			&summary.Status,
			&summary.RegisteredAt,
			&summary.CancelledAt,
			&summary.AttendanceStatus,
			&summary.CertificateCode,
		); err != nil {
			return nil, err
		}
		summaries[eventID] = summary
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return summaries, nil
}

type ListRegistrationsParams struct {
	EventID  int64
	Status   string
	Search   string
	PageSize int
	Offset   int
}

func (r *RegistrationRepository) ListEventRegistrations(ctx context.Context, params ListRegistrationsParams) ([]models.Registration, int, error) {
	where := []string{"r.event_id = $1"}
	args := []any{params.EventID}

	if status := strings.TrimSpace(params.Status); status != "" {
		args = append(args, status)
		where = append(where, fmt.Sprintf("r.status = $%d", len(args)))
	}
	if search := strings.TrimSpace(params.Search); search != "" {
		args = append(args, "%"+search+"%")
		where = append(where, fmt.Sprintf(
			"(s.full_name ILIKE $%d OR u.email ILIKE $%d OR s.enrollment_number ILIKE $%d)",
			len(args), len(args), len(args),
		))
	}

	clause := " WHERE " + strings.Join(where, " AND ")
	countSQL := `
		SELECT COUNT(*)
		FROM registrations r
		JOIN students s ON s.student_id = r.student_id
		JOIN users u ON u.user_id = s.user_id` + clause
	var total int
	if err := r.db.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	listSQL := registrationSelect + clause + " ORDER BY r.registered_at DESC, r.registration_id DESC"
	listArgs := append([]any{}, args...)
	if params.PageSize > 0 {
		listArgs = append(listArgs, params.PageSize)
		listSQL += fmt.Sprintf(" LIMIT $%d", len(listArgs))
		if params.Offset > 0 {
			listArgs = append(listArgs, params.Offset)
			listSQL += fmt.Sprintf(" OFFSET $%d", len(listArgs))
		}
	}

	rows, err := r.db.Query(ctx, listSQL, listArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	registrations, err := scanRegistrations(rows)
	if err != nil {
		return nil, 0, err
	}
	return registrations, total, nil
}

func (r *RegistrationRepository) ListByStudent(ctx context.Context, studentID int64, status string, pageSize, offset int) ([]models.Registration, int, error) {
	where := []string{"r.student_id = $1"}
	args := []any{studentID}
	if status = strings.TrimSpace(status); status != "" {
		args = append(args, status)
		where = append(where, fmt.Sprintf("r.status = $%d", len(args)))
	}
	clause := " WHERE " + strings.Join(where, " AND ")

	var total int
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM registrations r`+clause, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	listSQL := registrationSelect + clause + " ORDER BY r.registered_at DESC, r.registration_id DESC"
	listArgs := append([]any{}, args...)
	if pageSize > 0 {
		listArgs = append(listArgs, pageSize)
		listSQL += fmt.Sprintf(" LIMIT $%d", len(listArgs))
		if offset > 0 {
			listArgs = append(listArgs, offset)
			listSQL += fmt.Sprintf(" OFFSET $%d", len(listArgs))
		}
	}

	rows, err := r.db.Query(ctx, listSQL, listArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	registrations, err := scanRegistrations(rows)
	if err != nil {
		return nil, 0, err
	}
	return registrations, total, nil
}

func (r *RegistrationRepository) HasConfirmedRegistration(ctx context.Context, studentID, eventID int64) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM registrations
			WHERE student_id = $1 AND event_id = $2 AND status = 'confirmed'
		)
	`, studentID, eventID).Scan(&exists)
	return exists, err
}

func (r *RegistrationRepository) HasAttendance(ctx context.Context, registrationID int64) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM attendance WHERE registration_id = $1)
	`, registrationID).Scan(&exists)
	return exists, err
}

func (r *RegistrationRepository) Cancel(ctx context.Context, registrationID int64) error {
	tag, err := r.db.Exec(ctx, `
		UPDATE registrations
		SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP
		WHERE registration_id = $1
		  AND status = 'confirmed'
		  AND NOT EXISTS (
			SELECT 1 FROM attendance WHERE registration_id = $1
		  )
	`, registrationID)
	if err != nil {
		return mapRegistrationWriteError(err, "This registration cannot be cancelled.")
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *RegistrationRepository) HasFeedback(ctx context.Context, studentID, eventID int64) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM feedback WHERE student_id = $1 AND event_id = $2
		)
	`, studentID, eventID).Scan(&exists)
	return exists, err
}

func (r *RegistrationRepository) ListFeedback(ctx context.Context, eventID int64, studentID *int64) ([]models.Feedback, error) {
	where := []string{"f.event_id = $1"}
	args := []any{eventID}
	if studentID != nil {
		args = append(args, *studentID)
		where = append(where, fmt.Sprintf("f.student_id = $%d", len(args)))
	}

	rows, err := r.db.Query(ctx, `
		SELECT f.feedback_id, f.event_id, f.student_id, s.full_name,
		       f.rating, f.comments, f.created_at
		FROM feedback f
		JOIN students s ON s.student_id = f.student_id
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY f.created_at DESC, f.feedback_id DESC
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	feedback := make([]models.Feedback, 0)
	for rows.Next() {
		item, err := scanEventFeedback(rows)
		if err != nil {
			return nil, err
		}
		feedback = append(feedback, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return feedback, nil
}

func scanEventFeedback(row registrationQuerierRow) (models.Feedback, error) {
	var item models.Feedback
	err := row.Scan(
		&item.FeedbackID,
		&item.EventID,
		&item.StudentID,
		&item.StudentName,
		&item.Rating,
		&item.Comments,
		&item.CreatedAt,
	)
	return item, err
}

func (r *RegistrationRepository) CreateFeedback(ctx context.Context, studentID, eventID int64, rating int, comments string) (int64, error) {
	var feedbackID int64
	err := r.db.QueryRow(ctx, `
		INSERT INTO feedback (student_id, event_id, rating, comments)
		VALUES ($1, $2, $3, $4)
		RETURNING feedback_id
	`, studentID, eventID, rating, comments).Scan(&feedbackID)
	if err != nil {
		return 0, mapRegistrationWriteError(err, "You have already submitted feedback for this event.")
	}
	return feedbackID, nil
}

func (r *RegistrationRepository) FeedbackByID(ctx context.Context, feedbackID int64) (models.Feedback, error) {
	return scanEventFeedback(r.db.QueryRow(ctx, `
		SELECT f.feedback_id, f.event_id, f.student_id, s.full_name,
		       f.rating, f.comments, f.created_at
		FROM feedback f
		JOIN students s ON s.student_id = f.student_id
		WHERE f.feedback_id = $1
	`, feedbackID))
}

type AttendanceEntry struct {
	RegistrationID int64
	Status         string
}

const attendanceSelect = `
	SELECT
		a.attendance_id,
		a.registration_id,
		s.student_id,
		s.full_name,
		s.enrollment_number,
		a.attendance_status,
		a.marked_at,
		cert.certificate_code
	FROM attendance a
	JOIN registrations r ON r.registration_id = a.registration_id
	JOIN students s ON s.student_id = r.student_id
	LEFT JOIN certificates cert ON cert.registration_id = a.registration_id`

func scanAttendance(row registrationQuerierRow) (models.Attendance, error) {
	var attendance models.Attendance
	err := row.Scan(
		&attendance.AttendanceID,
		&attendance.RegistrationID,
		&attendance.StudentID,
		&attendance.StudentName,
		&attendance.EnrollmentNumber,
		&attendance.AttendanceStatus,
		&attendance.MarkedAt,
		&attendance.CertificateCode,
	)
	return attendance, err
}

func attendanceByID(ctx context.Context, q registrationQuerier, attendanceID int64) (models.Attendance, error) {
	return scanAttendance(q.QueryRow(ctx, attendanceSelect+` WHERE a.attendance_id = $1`, attendanceID))
}

func upsertAttendance(ctx context.Context, tx pgx.Tx, entry AttendanceEntry, markedBy int64) (int64, error) {
	var attendanceID int64
	err := tx.QueryRow(ctx, `
		INSERT INTO attendance (registration_id, attendance_status, marked_at, marked_by)
		VALUES ($1, $2, CURRENT_TIMESTAMP, $3)
		ON CONFLICT (registration_id) DO UPDATE
		SET attendance_status = EXCLUDED.attendance_status,
		    marked_at = CURRENT_TIMESTAMP,
		    marked_by = EXCLUDED.marked_by
		RETURNING attendance_id
	`, entry.RegistrationID, entry.Status, markedBy).Scan(&attendanceID)
	if err != nil {
		return 0, mapRegistrationWriteError(err, "Attendance could not be saved.")
	}
	return attendanceID, nil
}

func (r *RegistrationRepository) UpsertAttendance(ctx context.Context, registrationID int64, status string, markedBy int64) (models.Attendance, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return models.Attendance{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	attendanceID, err := upsertAttendance(ctx, tx, AttendanceEntry{
		RegistrationID: registrationID,
		Status:         status,
	}, markedBy)
	if err != nil {
		return models.Attendance{}, err
	}
	attendance, err := attendanceByID(ctx, tx, attendanceID)
	if err != nil {
		return models.Attendance{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return models.Attendance{}, err
	}
	return attendance, nil
}

// UpsertEventAttendance marks attendance for several registrations in one
// transaction, verifying that every registration belongs to the event.
func (r *RegistrationRepository) UpsertEventAttendance(ctx context.Context, eventID int64, entries []AttendanceEntry, markedBy int64) ([]models.Attendance, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	attendances := make([]models.Attendance, 0, len(entries))
	for _, entry := range entries {
		var (
			registrationEventID int64
			registrationStatus  string
		)
		err := tx.QueryRow(ctx, `
			SELECT event_id, status
			FROM registrations
			WHERE registration_id = $1
		`, entry.RegistrationID).Scan(&registrationEventID, &registrationStatus)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, apperr.BadRequest("One or more registrations do not belong to this event.")
		}
		if err != nil {
			return nil, err
		}
		if registrationEventID != eventID {
			return nil, apperr.BadRequest("One or more registrations do not belong to this event.")
		}
		if registrationStatus != "confirmed" {
			return nil, apperr.Unprocessable("Attendance can only be marked for confirmed registrations.")
		}

		attendanceID, err := upsertAttendance(ctx, tx, entry, markedBy)
		if err != nil {
			return nil, err
		}
		attendance, err := attendanceByID(ctx, tx, attendanceID)
		if err != nil {
			return nil, err
		}
		attendances = append(attendances, attendance)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return attendances, nil
}

// AwardCertificates issues certificates for all present attendees of an event
// that do not already have one. It is safe to call repeatedly.
func (r *RegistrationRepository) AwardCertificates(ctx context.Context, eventID int64) ([]models.Certificate, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	rows, err := tx.Query(ctx, `
		SELECT a.registration_id
		FROM attendance a
		JOIN registrations r ON r.registration_id = a.registration_id
		LEFT JOIN certificates cert ON cert.registration_id = a.registration_id
		WHERE r.event_id = $1
		  AND a.attendance_status = 'present'
		  AND cert.certificate_id IS NULL
		ORDER BY a.registration_id ASC
	`, eventID)
	if err != nil {
		return nil, err
	}
	registrationIDs := make([]int64, 0)
	for rows.Next() {
		var registrationID int64
		if err := rows.Scan(&registrationID); err != nil {
			rows.Close()
			return nil, err
		}
		registrationIDs = append(registrationIDs, registrationID)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}

	certificates := make([]models.Certificate, 0, len(registrationIDs))
	for _, registrationID := range registrationIDs {
		var certificateID int64
		if err := tx.QueryRow(ctx, `
			SELECT certificate_id FROM fn_award_certificate($1)
		`, registrationID).Scan(&certificateID); err != nil {
			return nil, mapRegistrationWriteError(err, "A certificate could not be issued.")
		}
		certificate, err := certificateByID(ctx, tx, certificateID)
		if err != nil {
			return nil, err
		}
		certificates = append(certificates, certificate)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return certificates, nil
}

const certificateSelect = `
	SELECT
		cert.certificate_id,
		cert.registration_id,
		cert.certificate_code,
		cert.issue_date,
		e.event_id,
		e.title,
		e.event_date,
		c.name,
		s.full_name
	FROM certificates cert
	JOIN registrations r ON r.registration_id = cert.registration_id
	JOIN students s ON s.student_id = r.student_id
	JOIN events e ON e.event_id = r.event_id
	JOIN clubs c ON c.club_id = e.club_id`

func scanCertificate(row registrationQuerierRow) (models.Certificate, error) {
	var certificate models.Certificate
	err := row.Scan(
		&certificate.CertificateID,
		&certificate.RegistrationID,
		&certificate.CertificateCode,
		&certificate.IssueDate,
		&certificate.EventID,
		&certificate.EventTitle,
		&certificate.EventDate,
		&certificate.ClubName,
		&certificate.StudentName,
	)
	return certificate, err
}

func certificateByID(ctx context.Context, q registrationQuerier, certificateID int64) (models.Certificate, error) {
	return scanCertificate(q.QueryRow(ctx, certificateSelect+` WHERE cert.certificate_id = $1`, certificateID))
}

func (r *RegistrationRepository) ListStudentCertificates(ctx context.Context, studentID int64) ([]models.Certificate, error) {
	rows, err := r.db.Query(ctx, certificateSelect+`
		WHERE s.student_id = $1
		ORDER BY cert.issue_date DESC, cert.certificate_id DESC
	`, studentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	certificates := make([]models.Certificate, 0)
	for rows.Next() {
		certificate, err := scanCertificate(rows)
		if err != nil {
			return nil, err
		}
		certificates = append(certificates, certificate)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return certificates, nil
}

func (r *RegistrationRepository) StudentExists(ctx context.Context, studentID int64) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM students WHERE student_id = $1)
	`, studentID).Scan(&exists)
	return exists, err
}

// CoordinatesStudentClub reports whether the user coordinates any club that the
// student is an approved member of.
func (a *Authz) CoordinatesStudentClub(ctx context.Context, userID, studentID int64) (bool, error) {
	var exists bool
	err := a.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM club_members target
			JOIN club_members coord ON coord.club_id = target.club_id
			JOIN students coordinator_student ON coordinator_student.student_id = coord.student_id
			WHERE target.student_id = $2
			  AND target.status = 'approved'
			  AND coord.role = 'coordinator'
			  AND coord.status = 'approved'
			  AND coordinator_student.user_id = $1
		)
	`, userID, studentID).Scan(&exists)
	return exists, err
}

// mapRegistrationWriteError converts trigger and constraint failures into
// readable conflicts or unprocessable responses.
func mapRegistrationWriteError(err error, defaultConflict string) error {
	if err == nil {
		return nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			return apperr.Conflict(defaultConflict)
		case "23503":
			return apperr.Conflict("This record is still referenced and cannot be changed.")
		case "23514":
			switch {
			case strings.Contains(pgErr.Message, "at capacity"):
				return apperr.Conflict("This event is full.")
			case strings.Contains(pgErr.Message, "confirmed registration"):
				return apperr.Unprocessable("Attendance can only be marked for confirmed registrations.")
			case strings.Contains(pgErr.Message, "exceeds venue capacity"):
				return apperr.Validation(map[string]string{
					"capacity": "Capacity cannot exceed the selected venue's capacity.",
				})
			}
			return apperr.Unprocessable("The operation violates a database rule.")
		case "22P02":
			return apperr.BadRequest("One of the provided values has an invalid format.")
		}
	}
	return err
}
