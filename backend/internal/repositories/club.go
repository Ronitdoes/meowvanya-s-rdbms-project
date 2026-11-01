package repositories

import (
	"context"
	"errors"

	"github.com/campusconnect/backend/internal/models"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Sentinels returned by club_members writes so the service layer can translate
// them into transport-safe application errors.
var (
	ErrClubNotApproved       = errors.New("club is not approved")
	ErrMembershipApproved    = errors.New("membership is already approved")
	ErrMembershipPending     = errors.New("membership is already pending")
	ErrMembershipNotPending  = errors.New("membership is not pending")
	ErrMembershipNotApproved = errors.New("membership is not approved")
	ErrLastCoordinator       = errors.New("cannot remove the last approved coordinator")
)

// ClubRepository owns club, membership and student-self persistence.
type ClubRepository struct {
	db *pgxpool.Pool
}

func NewClubRepository(db *pgxpool.Pool) *ClubRepository {
	return &ClubRepository{db: db}
}

type clubRowScanner interface {
	Scan(dest ...any) error
}

type clubRowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// clubSelect projects a club with membership counts and its first approved
// coordinator. Callers append their own WHERE/GROUP BY clauses.
const clubSelect = `
SELECT c.club_id, c.name, c.description, c.status, c.created_at,
       COUNT(cm.membership_id) FILTER (WHERE cm.status = 'approved')::int AS approved_members,
       COUNT(cm.membership_id) FILTER (WHERE cm.status = 'pending')::int AS pending_requests,
       coord.full_name, coord.email
FROM clubs c
LEFT JOIN club_members cm ON cm.club_id = c.club_id
LEFT JOIN LATERAL (
    SELECT s.full_name, u.email
    FROM club_members cmc
    JOIN students s ON s.student_id = cmc.student_id
    JOIN users u ON u.user_id = s.user_id
    WHERE cmc.club_id = c.club_id
      AND cmc.role = 'coordinator'
      AND cmc.status = 'approved'
    ORDER BY s.full_name ASC, cmc.membership_id ASC
    LIMIT 1
) coord ON TRUE
`

const clubGroup = ` GROUP BY c.club_id, coord.full_name, coord.email`

const clubSearchFilter = `($1 = '' OR c.name ILIKE '%' || $1 || '%' OR c.description ILIKE '%' || $1 || '%')`

func scanClub(row clubRowScanner) (models.Club, error) {
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

// ListApprovedClubs returns the public club directory page and its total.
func (r *ClubRepository) ListApprovedClubs(ctx context.Context, search string, limit, offset int) ([]models.Club, int, error) {
	var total int
	if err := r.db.QueryRow(ctx,
		`SELECT COUNT(*)::int FROM clubs c WHERE c.status = 'approved' AND `+clubSearchFilter,
		search,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	rows, err := r.db.Query(ctx,
		clubSelect+` WHERE c.status = 'approved' AND `+clubSearchFilter+clubGroup+
			` ORDER BY approved_members DESC, c.name ASC LIMIT $2 OFFSET $3`,
		search, limit, offset,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	clubs := make([]models.Club, 0, limit)
	for rows.Next() {
		club, err := scanClub(rows)
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

// FindApprovedClub loads a single publicly visible club.
func (r *ClubRepository) FindApprovedClub(ctx context.Context, clubID int64) (models.Club, error) {
	return scanClub(r.db.QueryRow(ctx,
		clubSelect+` WHERE c.club_id = $1 AND c.status = 'approved'`+clubGroup,
		clubID,
	))
}

// ClubStatus reports a club's lifecycle status.
func (r *ClubRepository) ClubStatus(ctx context.Context, clubID int64) (string, error) {
	var status string
	err := r.db.QueryRow(ctx, `SELECT status FROM clubs WHERE club_id = $1`, clubID).Scan(&status)
	return status, err
}

// ClubExists reports whether the club id is known.
func (r *ClubRepository) ClubExists(ctx context.Context, clubID int64) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM clubs WHERE club_id = $1)`, clubID).Scan(&exists)
	return exists, err
}

const membershipRequestSelect = `
SELECT cm.membership_id, cm.club_id, c.name, cm.status, cm.role,
       cm.requested_at, cm.decided_at, cm.joined_at
FROM club_members cm
JOIN clubs c ON c.club_id = cm.club_id
WHERE cm.membership_id = $1
`

func scanMembershipRequest(row clubRowScanner) (models.MembershipRequest, error) {
	var membership models.MembershipRequest
	err := row.Scan(
		&membership.MembershipID,
		&membership.ClubID,
		&membership.ClubName,
		&membership.Status,
		&membership.Role,
		&membership.RequestedAt,
		&membership.DecidedAt,
		&membership.JoinedAt,
	)
	return membership, err
}

func getMembershipRequest(ctx context.Context, q clubRowQuerier, membershipID int64) (models.MembershipRequest, error) {
	return scanMembershipRequest(q.QueryRow(ctx, membershipRequestSelect, membershipID))
}

// RequestMembership creates, reopens or rejects a join request. A student has
// at most one club_members row per club, so re-requests reuse it.
func (r *ClubRepository) RequestMembership(ctx context.Context, studentID, clubID int64) (models.MembershipRequest, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return models.MembershipRequest{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var clubStatus string
	if err := tx.QueryRow(ctx,
		`SELECT status FROM clubs WHERE club_id = $1 FOR SHARE`, clubID,
	).Scan(&clubStatus); err != nil {
		return models.MembershipRequest{}, err
	}
	if clubStatus != "approved" {
		return models.MembershipRequest{}, ErrClubNotApproved
	}

	var (
		membershipID int64
		current      string
	)
	err = tx.QueryRow(ctx,
		`SELECT membership_id, status FROM club_members
		 WHERE student_id = $1 AND club_id = $2
		 FOR UPDATE`,
		studentID, clubID,
	).Scan(&membershipID, &current)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		err = tx.QueryRow(ctx, `
			INSERT INTO club_members (student_id, club_id, role, status)
			VALUES ($1, $2, 'member', 'pending')
			RETURNING membership_id
		`, studentID, clubID).Scan(&membershipID)
		if err != nil {
			return models.MembershipRequest{}, MapPGError(err, "You have already requested to join this club.")
		}
	case err != nil:
		return models.MembershipRequest{}, err
	case current == "approved":
		return models.MembershipRequest{}, ErrMembershipApproved
	case current == "pending":
		return models.MembershipRequest{}, ErrMembershipPending
	case current == "rejected":
		if _, err := tx.Exec(ctx, `
			UPDATE club_members
			SET status = 'pending',
			    requested_at = CURRENT_TIMESTAMP,
			    decided_at = NULL,
			    decided_by = NULL,
			    joined_at = NULL
			WHERE membership_id = $1
		`, membershipID); err != nil {
			return models.MembershipRequest{}, MapPGError(err, "The membership request could not be reopened.")
		}
	default:
		return models.MembershipRequest{}, ErrMembershipNotApproved
	}

	membership, err := getMembershipRequest(ctx, tx, membershipID)
	if err != nil {
		return models.MembershipRequest{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return models.MembershipRequest{}, err
	}
	return membership, nil
}

const clubMemberSelect = `
SELECT cm.membership_id, cm.student_id, cm.club_id, c.name, s.full_name, u.email,
       s.enrollment_number, d.name, cm.role, cm.status,
       cm.requested_at, cm.decided_at, cm.joined_at
FROM club_members cm
JOIN clubs c ON c.club_id = cm.club_id
JOIN students s ON s.student_id = cm.student_id
JOIN users u ON u.user_id = s.user_id
JOIN departments d ON d.department_id = s.department_id
`

func scanClubMember(row clubRowScanner) (models.ClubMember, error) {
	var member models.ClubMember
	err := row.Scan(
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
	)
	return member, err
}

func getClubMember(ctx context.Context, q clubRowQuerier, clubID, membershipID int64) (models.ClubMember, error) {
	return scanClubMember(q.QueryRow(ctx,
		clubMemberSelect+` WHERE cm.club_id = $1 AND cm.membership_id = $2`,
		clubID, membershipID,
	))
}

// ListClubMembers returns a filtered membership page for a club.
func (r *ClubRepository) ListClubMembers(ctx context.Context, clubID int64, status, search string, limit, offset int) ([]models.ClubMember, int, error) {
	const filters = `
		WHERE cm.club_id = $1
		  AND ($2 = '' OR cm.status = $2)
		  AND ($3 = '' OR s.full_name ILIKE '%' || $3 || '%'
		       OR u.email ILIKE '%' || $3 || '%'
		       OR s.enrollment_number ILIKE '%' || $3 || '%')`

	var total int
	if err := r.db.QueryRow(ctx, `
		SELECT COUNT(*)::int
		FROM club_members cm
		JOIN students s ON s.student_id = cm.student_id
		JOIN users u ON u.user_id = s.user_id
	`+filters, clubID, status, search).Scan(&total); err != nil {
		return nil, 0, err
	}

	rows, err := r.db.Query(ctx,
		clubMemberSelect+filters+`
		ORDER BY cm.requested_at DESC, cm.membership_id DESC
		LIMIT $4 OFFSET $5`,
		clubID, status, search, limit, offset,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	members := make([]models.ClubMember, 0, limit)
	for rows.Next() {
		member, err := scanClubMember(rows)
		if err != nil {
			return nil, 0, err
		}
		members = append(members, member)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return members, total, nil
}

// DecideClubMembership approves or rejects a still-pending request.
func (r *ClubRepository) DecideClubMembership(ctx context.Context, clubID, membershipID int64, status string, decidedBy int64) (models.ClubMember, error) {
	tag, err := r.db.Exec(ctx, `
		UPDATE club_members
		SET status = $3,
		    decided_at = CURRENT_TIMESTAMP,
		    decided_by = $4,
		    joined_at = CASE WHEN $3 = 'approved' THEN CURRENT_TIMESTAMP ELSE NULL END
		WHERE membership_id = $1 AND club_id = $2 AND status = 'pending'
	`, membershipID, clubID, status, decidedBy)
	if err != nil {
		return models.ClubMember{}, MapPGError(err, "This membership request could not be updated.")
	}
	if tag.RowsAffected() == 0 {
		var current string
		if err := r.db.QueryRow(ctx,
			`SELECT status FROM club_members WHERE membership_id = $1 AND club_id = $2`,
			membershipID, clubID,
		).Scan(&current); err != nil {
			return models.ClubMember{}, err
		}
		return models.ClubMember{}, ErrMembershipNotPending
	}
	return getClubMember(ctx, r.db, clubID, membershipID)
}

// UpdateMembershipRole changes an approved member's role, keeping at least one
// approved coordinator per club.
func (r *ClubRepository) UpdateMembershipRole(ctx context.Context, clubID, membershipID int64, role string) (models.ClubMember, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return models.ClubMember{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := lockClubRow(ctx, tx, clubID); err != nil {
		return models.ClubMember{}, err
	}

	var currentRole, currentStatus string
	if err := tx.QueryRow(ctx, `
		SELECT role, status FROM club_members
		WHERE membership_id = $1 AND club_id = $2
		FOR UPDATE
	`, membershipID, clubID).Scan(&currentRole, &currentStatus); err != nil {
		return models.ClubMember{}, err
	}
	if currentStatus != "approved" {
		return models.ClubMember{}, ErrMembershipNotApproved
	}

	if currentRole != role {
		if currentStatus == "approved" && currentRole == "coordinator" && role == "member" {
			others, err := approvedCoordinatorCount(ctx, tx, clubID, membershipID)
			if err != nil {
				return models.ClubMember{}, err
			}
			if others == 0 {
				return models.ClubMember{}, ErrLastCoordinator
			}
		}
		if _, err := tx.Exec(ctx,
			`UPDATE club_members SET role = $3 WHERE membership_id = $1 AND club_id = $2`,
			membershipID, clubID, role,
		); err != nil {
			return models.ClubMember{}, MapPGError(err, "The member role could not be updated.")
		}
	}

	member, err := getClubMember(ctx, tx, clubID, membershipID)
	if err != nil {
		return models.ClubMember{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return models.ClubMember{}, err
	}
	return member, nil
}

// DeleteMembership removes a club member, refusing to remove the last approved
// coordinator.
func (r *ClubRepository) DeleteMembership(ctx context.Context, clubID, membershipID int64) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := lockClubRow(ctx, tx, clubID); err != nil {
		return err
	}

	var role, status string
	if err := tx.QueryRow(ctx, `
		SELECT role, status FROM club_members
		WHERE membership_id = $1 AND club_id = $2
		FOR UPDATE
	`, membershipID, clubID).Scan(&role, &status); err != nil {
		return err
	}
	if role == "coordinator" && status == "approved" {
		others, err := approvedCoordinatorCount(ctx, tx, clubID, membershipID)
		if err != nil {
			return err
		}
		if others == 0 {
			return ErrLastCoordinator
		}
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM club_members WHERE membership_id = $1 AND club_id = $2`,
		membershipID, clubID,
	); err != nil {
		return MapPGError(err, "The member could not be removed.")
	}
	return tx.Commit(ctx)
}

func lockClubRow(ctx context.Context, tx pgx.Tx, clubID int64) error {
	var id int64
	return tx.QueryRow(ctx, `SELECT club_id FROM clubs WHERE club_id = $1 FOR UPDATE`, clubID).Scan(&id)
}

func approvedCoordinatorCount(ctx context.Context, q clubRowQuerier, clubID, excludeMembershipID int64) (int, error) {
	var count int
	err := q.QueryRow(ctx, `
		SELECT COUNT(*)::int
		FROM club_members
		WHERE club_id = $1
		  AND membership_id <> $2
		  AND role = 'coordinator'
		  AND status = 'approved'
	`, clubID, excludeMembershipID).Scan(&count)
	return count, err
}

// ListMembershipsForStudent returns every club membership row for the caller.
func (r *ClubRepository) ListMembershipsForStudent(ctx context.Context, studentID int64) ([]models.MembershipRequest, error) {
	rows, err := r.db.Query(ctx, `
		SELECT cm.membership_id, cm.club_id, c.name, cm.status, cm.role,
		       cm.requested_at, cm.decided_at, cm.joined_at
		FROM club_members cm
		JOIN clubs c ON c.club_id = cm.club_id
		WHERE cm.student_id = $1
		ORDER BY cm.requested_at DESC, cm.membership_id DESC
	`, studentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	memberships := make([]models.MembershipRequest, 0, 8)
	for rows.Next() {
		membership, err := scanMembershipRequest(rows)
		if err != nil {
			return nil, err
		}
		memberships = append(memberships, membership)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return memberships, nil
}

// DashboardCounts is the scalar portion of the student dashboard.
type DashboardCounts struct {
	ClubsJoined           int
	ApprovedMemberships   int
	PendingMemberships    int
	EventsRegistered      int
	UpcomingRegistrations int
	CertificatesEarned    int
}

func (r *ClubRepository) StudentDashboardCounts(ctx context.Context, studentID int64) (DashboardCounts, error) {
	var counts DashboardCounts
	err := r.db.QueryRow(ctx, `
		SELECT
		    (SELECT COUNT(*)::int FROM club_members
		     WHERE student_id = $1 AND status = 'approved'),
		    (SELECT COUNT(*)::int FROM club_members
		     WHERE student_id = $1 AND status = 'approved'),
		    (SELECT COUNT(*)::int FROM club_members
		     WHERE student_id = $1 AND status = 'pending'),
		    (SELECT COUNT(*)::int FROM registrations
		     WHERE student_id = $1 AND status <> 'cancelled'),
		    (SELECT COUNT(*)::int
		     FROM registrations r
		     JOIN events e ON e.event_id = r.event_id
		     WHERE r.student_id = $1
		       AND r.status = 'confirmed'
		       AND e.event_date > CURRENT_TIMESTAMP),
		    (SELECT COUNT(*)::int
		     FROM certificates cert
		     JOIN registrations r ON r.registration_id = cert.registration_id
		     WHERE r.student_id = $1)
	`, studentID).Scan(
		&counts.ClubsJoined,
		&counts.ApprovedMemberships,
		&counts.PendingMemberships,
		&counts.EventsRegistered,
		&counts.UpcomingRegistrations,
		&counts.CertificatesEarned,
	)
	return counts, err
}

// UpcomingEvents returns published future events for the student dashboard.
func (r *ClubRepository) UpcomingEvents(ctx context.Context, limit int) ([]models.Event, error) {
	rows, err := r.db.Query(ctx, `
		SELECT e.event_id, e.club_id, ue.club_name, e.venue_id, ue.venue_name,
		       v.capacity, e.created_by, e.title, e.description, e.event_date,
		       e.registration_deadline, e.capacity, e.status, e.rejection_reason,
		       e.created_at, e.updated_at,
		       ue.confirmed_registrations,
		       COALESCE(ers.total_registrations, 0)::int,
		       ue.seats_remaining,
		       ers.average_rating::float8,
		       COALESCE(ers.feedback_count, 0)::int
		FROM upcoming_events ue
		JOIN events e ON e.event_id = ue.event_id
		JOIN venues v ON v.venue_id = e.venue_id
		LEFT JOIN event_registration_summary ers ON ers.event_id = e.event_id
		ORDER BY e.event_date ASC, e.event_id ASC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := make([]models.Event, 0, limit)
	for rows.Next() {
		var event models.Event
		if err := rows.Scan(
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
		); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return events, nil
}

// RecentRegistrations returns the caller's latest registration history rows.
func (r *ClubRepository) RecentRegistrations(ctx context.Context, studentID int64, limit int) ([]models.Registration, error) {
	rows, err := r.db.Query(ctx, `
		SELECT r.registration_id, r.student_id, r.event_id, s.full_name, u.email,
		       s.enrollment_number, d.name, c.name, e.title, e.event_date,
		       v.name, r.status, r.registered_at, r.cancelled_at,
		       a.attendance_status, cert.certificate_code, cert.certificate_id
		FROM registrations r
		JOIN students s ON s.student_id = r.student_id
		JOIN users u ON u.user_id = s.user_id
		JOIN departments d ON d.department_id = s.department_id
		JOIN events e ON e.event_id = r.event_id
		JOIN clubs c ON c.club_id = e.club_id
		JOIN venues v ON v.venue_id = e.venue_id
		LEFT JOIN attendance a ON a.registration_id = r.registration_id
		LEFT JOIN certificates cert ON cert.registration_id = r.registration_id
		WHERE r.student_id = $1
		ORDER BY r.registered_at DESC, r.registration_id DESC
		LIMIT $2
	`, studentID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	registrations := make([]models.Registration, 0, limit)
	for rows.Next() {
		var registration models.Registration
		if err := rows.Scan(
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
		); err != nil {
			return nil, err
		}
		registrations = append(registrations, registration)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return registrations, nil
}

// CoordinatedClubs lists the clubs where the user holds an approved coordinator
// membership.
func (r *ClubRepository) CoordinatedClubs(ctx context.Context, userID int64) ([]models.Club, error) {
	rows, err := r.db.Query(ctx, clubSelect+`
		WHERE EXISTS (
		    SELECT 1
		    FROM club_members cmx
		    JOIN students sx ON sx.student_id = cmx.student_id
		    WHERE cmx.club_id = c.club_id
		      AND sx.user_id = $1
		      AND cmx.role = 'coordinator'
		      AND cmx.status = 'approved'
		)`+clubGroup+`
		ORDER BY c.name ASC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	clubs := make([]models.Club, 0, 4)
	for rows.Next() {
		club, err := scanClub(rows)
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
