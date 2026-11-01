package repositories

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/campusconnect/backend/internal/apperr"
	"github.com/campusconnect/backend/internal/models"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// EventRepository owns event discovery, management and coordinator dashboard
// queries.
type EventRepository struct {
	db *pgxpool.Pool
}

func NewEventRepository(db *pgxpool.Pool) *EventRepository {
	return &EventRepository{db: db}
}

const eventSelect = `
	SELECT
		e.event_id,
		e.club_id,
		c.name,
		e.venue_id,
		v.name,
		v.capacity,
		e.created_by,
		e.title,
		e.description,
		e.event_date,
		e.registration_deadline,
		e.capacity,
		e.status,
		e.rejection_reason,
		e.created_at,
		e.updated_at,
		(SELECT COUNT(*) FROM registrations r
			WHERE r.event_id = e.event_id AND r.status = 'confirmed')::INTEGER,
		(SELECT COUNT(*) FROM registrations r
			WHERE r.event_id = e.event_id)::INTEGER,
		(SELECT ROUND(AVG(f.rating)::NUMERIC, 2)::DOUBLE PRECISION
			FROM feedback f WHERE f.event_id = e.event_id),
		(SELECT COUNT(*) FROM feedback f WHERE f.event_id = e.event_id)::INTEGER
	FROM events e
	JOIN clubs c ON c.club_id = e.club_id
	JOIN venues v ON v.venue_id = e.venue_id`

type eventScanner interface {
	Scan(dest ...any) error
}

func scanEvent(row eventScanner) (models.Event, error) {
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
		&event.AverageRating,
		&event.FeedbackCount,
	)
	if err != nil {
		return models.Event{}, err
	}
	event.SeatsRemaining = event.Capacity - event.ConfirmedCount
	if event.SeatsRemaining < 0 {
		event.SeatsRemaining = 0
	}
	return event, nil
}

func scanEvents(rows pgx.Rows) ([]models.Event, error) {
	events := make([]models.Event, 0)
	for rows.Next() {
		event, err := scanEvent(rows)
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

type ListEventsParams struct {
	Search   string
	ClubID   int64
	Status   string
	Upcoming bool
	PageSize int
	Offset   int
}

// ListPublic returns published events ordered by event date.
func (r *EventRepository) ListPublic(ctx context.Context, params ListEventsParams) ([]models.Event, int, error) {
	where := []string{"e.status = 'published'"}
	args := make([]any, 0, 4)

	if params.Upcoming {
		where = append(where, "e.event_date >= CURRENT_TIMESTAMP")
	}
	if params.ClubID > 0 {
		args = append(args, params.ClubID)
		where = append(where, fmt.Sprintf("e.club_id = $%d", len(args)))
	}
	if search := strings.TrimSpace(params.Search); search != "" {
		args = append(args, "%"+search+"%")
		where = append(where, fmt.Sprintf("(e.title ILIKE $%d OR c.name ILIKE $%d)", len(args), len(args)))
	}

	return r.list(ctx, where, args, "e.event_date ASC, e.event_id ASC", params.PageSize, params.Offset)
}

// GetPublic returns an event visible to the public, i.e. published or completed.
func (r *EventRepository) GetPublic(ctx context.Context, eventID int64) (models.Event, error) {
	event, err := scanEvent(r.db.QueryRow(ctx, eventSelect+`
		WHERE e.event_id = $1 AND e.status IN ('published', 'completed')
	`, eventID))
	return event, err
}

// ListManaged returns events belonging to the clubs a user coordinates. When
// all is true (admin), every event is returned regardless of coordinator
// assignments. All filters are fixed fragments with bound arguments.
func (r *EventRepository) ListManaged(ctx context.Context, userID int64, all bool, params ListEventsParams) ([]models.Event, int, error) {
	where := make([]string, 0, 5)
	args := make([]any, 0, 5)

	if !all {
		args = append(args, userID)
		where = append(where, fmt.Sprintf(`e.club_id IN (
			SELECT cm.club_id
			FROM club_members cm
			JOIN students s ON s.student_id = cm.student_id
			WHERE s.user_id = $%d
			  AND cm.role = 'coordinator'
			  AND cm.status = 'approved'
		)`, len(args)))
	}
	if params.Upcoming {
		where = append(where, "e.event_date >= CURRENT_TIMESTAMP")
	}
	if params.ClubID > 0 {
		args = append(args, params.ClubID)
		where = append(where, fmt.Sprintf("e.club_id = $%d", len(args)))
	}
	if params.Status != "" {
		args = append(args, params.Status)
		where = append(where, fmt.Sprintf("e.status = $%d", len(args)))
	}
	if search := strings.TrimSpace(params.Search); search != "" {
		args = append(args, "%"+search+"%")
		where = append(where, fmt.Sprintf("(e.title ILIKE $%d OR c.name ILIKE $%d)", len(args), len(args)))
	}

	return r.list(ctx, where, args, "e.event_date ASC, e.event_id ASC", params.PageSize, params.Offset)
}

// GetByID returns an event regardless of status.
func (r *EventRepository) GetByID(ctx context.Context, eventID int64) (models.Event, error) {
	event, err := scanEvent(r.db.QueryRow(ctx, eventSelect+`
		WHERE e.event_id = $1
	`, eventID))
	return event, err
}

func (r *EventRepository) list(
	ctx context.Context,
	where []string,
	args []any,
	order string,
	pageSize, offset int,
) ([]models.Event, int, error) {
	clause := ""
	if len(where) > 0 {
		clause = " WHERE " + strings.Join(where, " AND ")
	}

	countSQL := `
		SELECT COUNT(*)
		FROM events e
		JOIN clubs c ON c.club_id = e.club_id
		JOIN venues v ON v.venue_id = e.venue_id` + clause
	var total int
	if err := r.db.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	listSQL := eventSelect + clause + " ORDER BY " + order
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

	events, err := scanEvents(rows)
	if err != nil {
		return nil, 0, err
	}
	return events, total, nil
}

type CreateEventParams struct {
	ClubID               int64
	VenueID              int64
	CreatedBy            int64
	Title                string
	Description          string
	EventDate            time.Time
	RegistrationDeadline time.Time
	Capacity             int
}

func (r *EventRepository) Create(ctx context.Context, params CreateEventParams) (int64, error) {
	var eventID int64
	err := r.db.QueryRow(ctx, `
		INSERT INTO events (
			club_id, venue_id, created_by, title, description,
			event_date, registration_deadline, capacity, status
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
		RETURNING event_id
	`,
		params.ClubID,
		params.VenueID,
		params.CreatedBy,
		params.Title,
		params.Description,
		params.EventDate,
		params.RegistrationDeadline,
		params.Capacity,
	).Scan(&eventID)
	if err != nil {
		return 0, mapEventWriteError(err)
	}
	return eventID, nil
}

type UpdateEventParams struct {
	ClubID               *int64
	VenueID              *int64
	Title                *string
	Description          *string
	EventDate            *time.Time
	RegistrationDeadline *time.Time
	Capacity             *int
}

func (r *EventRepository) Update(ctx context.Context, eventID int64, params UpdateEventParams) error {
	tag, err := r.db.Exec(ctx, `
		UPDATE events
		SET club_id = COALESCE($2, club_id),
		    venue_id = COALESCE($3, venue_id),
		    title = COALESCE($4, title),
		    description = COALESCE($5, description),
		    event_date = COALESCE($6, event_date),
		    registration_deadline = COALESCE($7, registration_deadline),
		    capacity = COALESCE($8, capacity),
		    updated_at = CURRENT_TIMESTAMP
		WHERE event_id = $1
	`,
		eventID,
		params.ClubID,
		params.VenueID,
		params.Title,
		params.Description,
		params.EventDate,
		params.RegistrationDeadline,
		params.Capacity,
	)
	if err != nil {
		return mapEventWriteError(err)
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *EventRepository) Delete(ctx context.Context, eventID int64) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM events WHERE event_id = $1`, eventID)
	if err != nil {
		return mapEventWriteError(err)
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *EventRepository) ClubStatus(ctx context.Context, clubID int64) (string, error) {
	var status string
	err := r.db.QueryRow(ctx, `SELECT status FROM clubs WHERE club_id = $1`, clubID).Scan(&status)
	return status, err
}

func (r *EventRepository) VenueCapacity(ctx context.Context, venueID int64) (int, error) {
	var capacity int
	err := r.db.QueryRow(ctx, `SELECT capacity FROM venues WHERE venue_id = $1`, venueID).Scan(&capacity)
	return capacity, err
}

func (r *EventRepository) Stats(ctx context.Context, eventID int64) (models.EventStats, error) {
	var stats models.EventStats
	err := r.db.QueryRow(ctx, `
		SELECT event_id, title, capacity, total_registrations,
		       confirmed_registrations, cancelled_registrations,
		       present_count, absent_count, average_rating, feedback_count
		FROM fn_event_stats($1)
	`, eventID).Scan(
		&stats.EventID,
		&stats.Title,
		&stats.Capacity,
		&stats.TotalRegistrations,
		&stats.ConfirmedRegistrations,
		&stats.CancelledRegistrations,
		&stats.PresentCount,
		&stats.AbsentCount,
		&stats.AverageRating,
		&stats.FeedbackCount,
	)
	return stats, err
}

// CoordinatedClubs returns the clubs the user coordinates with membership
// roll-up counts and the club's primary coordinator.
func (r *EventRepository) CoordinatedClubs(ctx context.Context, userID int64) ([]models.Club, error) {
	rows, err := r.db.Query(ctx, `
		SELECT c.club_id, c.name, c.description, c.status, c.created_at,
		       COALESCE(cms.approved_members, 0),
		       COALESCE(cms.pending_requests, 0),
		       coord.full_name, coord.email,
		       cm.role, cm.status
		FROM clubs c
		JOIN club_members cm ON cm.club_id = c.club_id
		JOIN students s ON s.student_id = cm.student_id
		LEFT JOIN club_membership_summary cms ON cms.club_id = c.club_id
		LEFT JOIN LATERAL (
			SELECT st.full_name, u.email
			FROM club_members cm2
			JOIN students st ON st.student_id = cm2.student_id
			JOIN users u ON u.user_id = st.user_id
			WHERE cm2.club_id = c.club_id
			  AND cm2.role = 'coordinator'
			  AND cm2.status = 'approved'
			ORDER BY cm2.joined_at ASC NULLS LAST, cm2.membership_id ASC
			LIMIT 1
		) coord ON TRUE
		WHERE s.user_id = $1
		  AND cm.role = 'coordinator'
		  AND cm.status = 'approved'
		ORDER BY c.name ASC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	clubs := make([]models.Club, 0)
	for rows.Next() {
		var (
			club   models.Club
			role   string
			status string
		)
		if err := rows.Scan(
			&club.ClubID,
			&club.Name,
			&club.Description,
			&club.Status,
			&club.CreatedAt,
			&club.ApprovedMembers,
			&club.PendingRequests,
			&club.CoordinatorName,
			&club.CoordinatorEmail,
			&role,
			&status,
		); err != nil {
			return nil, err
		}
		club.MyRole = &role
		club.MyStatus = &status
		clubs = append(clubs, club)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return clubs, nil
}

func (r *EventRepository) CoordinatorStats(ctx context.Context, userID int64) (models.CoordinatorStats, error) {
	var stats models.CoordinatorStats
	err := r.db.QueryRow(ctx, `
		WITH managed AS (
			SELECT c.club_id
			FROM clubs c
			JOIN club_members cm ON cm.club_id = c.club_id
			JOIN students s ON s.student_id = cm.student_id
			WHERE s.user_id = $1
			  AND cm.role = 'coordinator'
			  AND cm.status = 'approved'
		)
		SELECT
			(SELECT COUNT(*)::INTEGER FROM managed),
			(SELECT COUNT(*)::INTEGER FROM events e
				WHERE e.club_id IN (SELECT club_id FROM managed)),
			(SELECT COUNT(*)::INTEGER FROM events e
				WHERE e.club_id IN (SELECT club_id FROM managed) AND e.status = 'published'),
			(SELECT COUNT(*)::INTEGER FROM events e
				WHERE e.club_id IN (SELECT club_id FROM managed)
				  AND e.status = 'published'
				  AND e.event_date >= CURRENT_TIMESTAMP),
			(SELECT COUNT(*)::INTEGER FROM club_members cm
				WHERE cm.club_id IN (SELECT club_id FROM managed) AND cm.status = 'approved'),
			(SELECT COUNT(*)::INTEGER FROM club_members cm
				WHERE cm.club_id IN (SELECT club_id FROM managed) AND cm.status = 'pending'),
			(SELECT COUNT(*)::INTEGER FROM registrations r
				JOIN events e ON e.event_id = r.event_id
				WHERE e.club_id IN (SELECT club_id FROM managed)),
			(SELECT COUNT(*)::INTEGER FROM certificates cert
				JOIN registrations r ON r.registration_id = cert.registration_id
				JOIN events e ON e.event_id = r.event_id
				WHERE e.club_id IN (SELECT club_id FROM managed)),
			COALESCE((
				SELECT ROUND(AVG(f.rating)::NUMERIC, 2)::DOUBLE PRECISION
				FROM feedback f
				JOIN events e ON e.event_id = f.event_id
				WHERE e.club_id IN (SELECT club_id FROM managed)
			), 0),
			(SELECT COUNT(*)::INTEGER FROM events e
				WHERE e.club_id IN (SELECT club_id FROM managed) AND e.status = 'pending')
	`, userID).Scan(
		&stats.Clubs,
		&stats.TotalEvents,
		&stats.PublishedEvents,
		&stats.UpcomingEvents,
		&stats.ApprovedMembers,
		&stats.PendingMembers,
		&stats.TotalRegistrations,
		&stats.CertificatesIssued,
		&stats.AverageRating,
		&stats.PendingEvents,
	)
	return stats, err
}

func (r *EventRepository) CoordinatorPendingMembers(ctx context.Context, userID int64, limit int) ([]models.ClubMember, error) {
	rows, err := r.db.Query(ctx, `
		SELECT cm.membership_id, cm.student_id, cm.club_id, c.name,
		       s.full_name, u.email, s.enrollment_number, d.name,
		       cm.role, cm.status, cm.requested_at, cm.decided_at, cm.joined_at
		FROM club_members cm
		JOIN clubs c ON c.club_id = cm.club_id
		JOIN students s ON s.student_id = cm.student_id
		JOIN users u ON u.user_id = s.user_id
		JOIN departments d ON d.department_id = s.department_id
		WHERE cm.status = 'pending'
		  AND cm.club_id IN (
			SELECT c2.club_id
			FROM clubs c2
			JOIN club_members cm2 ON cm2.club_id = c2.club_id
			JOIN students s2 ON s2.student_id = cm2.student_id
			WHERE s2.user_id = $1
			  AND cm2.role = 'coordinator'
			  AND cm2.status = 'approved'
		  )
		ORDER BY cm.requested_at DESC, cm.membership_id DESC
		LIMIT $2
	`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	members := make([]models.ClubMember, 0)
	for rows.Next() {
		var member models.ClubMember
		if err := rows.Scan(
			&member.MembershipID,
			&member.StudentID,
			&member.ClubID,
			&member.ClubName,
			&member.FullName,
			&member.Email,
			&member.EnrollmentNumber,
			&member.DepartmentName,
			&member.Role,
			&member.Status,
			&member.RequestedAt,
			&member.DecidedAt,
			&member.JoinedAt,
		); err != nil {
			return nil, err
		}
		members = append(members, member)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return members, nil
}

func (r *EventRepository) CoordinatorUpcomingEvents(ctx context.Context, userID int64, limit int) ([]models.Event, error) {
	rows, err := r.db.Query(ctx, eventSelect+`
		WHERE e.status = 'published'
		  AND e.event_date >= CURRENT_TIMESTAMP
		  AND EXISTS (
			SELECT 1
			FROM club_members cm
			JOIN students s ON s.student_id = cm.student_id
			WHERE cm.club_id = e.club_id
			  AND cm.role = 'coordinator'
			  AND cm.status = 'approved'
			  AND s.user_id = $1
		  )
		ORDER BY e.event_date ASC, e.event_id ASC
		LIMIT $2
	`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events, err := scanEvents(rows)
	if err != nil {
		return nil, err
	}
	return events, nil
}

func (r *EventRepository) CoordinatorRecentFeedback(ctx context.Context, userID int64, limit int) ([]models.Feedback, error) {
	rows, err := r.db.Query(ctx, `
		SELECT f.feedback_id, f.event_id, f.student_id, s.full_name,
		       f.rating, f.comments, f.created_at
		FROM feedback f
		JOIN students s ON s.student_id = f.student_id
		JOIN events e ON e.event_id = f.event_id
		WHERE e.club_id IN (
			SELECT c.club_id
			FROM clubs c
			JOIN club_members cm ON cm.club_id = c.club_id
			JOIN students s2 ON s2.student_id = cm.student_id
			WHERE s2.user_id = $1
			  AND cm.role = 'coordinator'
			  AND cm.status = 'approved'
		)
		ORDER BY f.created_at DESC, f.feedback_id DESC
		LIMIT $2
	`, userID, limit)
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

// mapEventWriteError turns event constraint failures into safe field-level
// validation errors or readable conflicts.
func mapEventWriteError(err error) error {
	if err == nil {
		return nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			return apperr.Conflict("This event conflicts with an existing record.")
		case "23503":
			switch pgErr.ConstraintName {
			case "events_club_fk":
				return apperr.Validation(map[string]string{"clubId": "Select an existing club."})
			case "events_venue_fk":
				return apperr.Validation(map[string]string{"venueId": "Select an existing venue."})
			case "events_created_by_fk":
				return apperr.Conflict("The event creator no longer exists.")
			}
			return apperr.Conflict("This event is still referenced and cannot be changed.")
		case "23514":
			switch {
			case strings.Contains(pgErr.Message, "exceeds venue capacity"):
				return apperr.Validation(map[string]string{
					"capacity": "Capacity cannot exceed the selected venue's capacity.",
				})
			case pgErr.ConstraintName == "events_deadline_before_event":
				return apperr.Validation(map[string]string{
					"registrationDeadline": "Registration deadline must be on or before the event date.",
				})
			case pgErr.ConstraintName == "events_capacity_positive":
				return apperr.Validation(map[string]string{
					"capacity": "Capacity must be greater than zero.",
				})
			}
			return apperr.Unprocessable("The operation violates an event rule.")
		case "22P02":
			return apperr.BadRequest("One of the provided values has an invalid format.")
		}
	}
	return err
}
