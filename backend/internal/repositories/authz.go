package repositories

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Authz centralizes the club-coordinator authorization lookup used by several
// feature slices, so the rule lives in exactly one place.
type Authz struct {
	db *pgxpool.Pool
}

func NewAuthz(db *pgxpool.Pool) *Authz { return &Authz{db: db} }

// IsClubCoordinator reports whether the user's student profile holds an
// approved coordinator membership for the club.
func (a *Authz) IsClubCoordinator(ctx context.Context, userID, clubID int64) (bool, error) {
	var exists bool
	err := a.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM club_members cm
			JOIN students s ON s.student_id = cm.student_id
			WHERE s.user_id = $1
			  AND cm.club_id = $2
			  AND cm.role = 'coordinator'
			  AND cm.status = 'approved'
		)
	`, userID, clubID).Scan(&exists)
	return exists, err
}

// IsEventCoordinator resolves the coordinator relationship through the event's
// club.
func (a *Authz) IsEventCoordinator(ctx context.Context, userID, eventID int64) (bool, error) {
	var exists bool
	err := a.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM events e
			JOIN club_members cm ON cm.club_id = e.club_id
			JOIN students s ON s.student_id = cm.student_id
			WHERE e.event_id = $1
			  AND s.user_id = $2
			  AND cm.role = 'coordinator'
			  AND cm.status = 'approved'
		)
	`, eventID, userID).Scan(&exists)
	return exists, err
}

// StudentIDForUser returns the student profile id, or (0, nil) when the user
// has no profile. Callers distinguish "no profile" from a lookup failure.
func (a *Authz) StudentIDForUser(ctx context.Context, userID int64) (int64, error) {
	var studentID int64
	err := a.db.QueryRow(ctx, `SELECT student_id FROM students WHERE user_id = $1`, userID).Scan(&studentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return studentID, err
}
