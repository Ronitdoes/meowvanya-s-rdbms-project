package tests

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestSQLViewsFunctionsAndIndexes(t *testing.T) {
	resetSeed(t)
	ctx := context.Background()

	var upcoming, summary, memberships, history, platform int
	for query, target := range map[string]*int{
		`SELECT COUNT(*) FROM upcoming_events`:              &upcoming,
		`SELECT COUNT(*) FROM event_registration_summary`:   &summary,
		`SELECT COUNT(*) FROM club_membership_summary`:      &memberships,
		`SELECT COUNT(*) FROM student_registration_history`: &history,
		`SELECT COUNT(*) FROM platform_stats`:               &platform,
	} {
		if err := testPool.QueryRow(ctx, query).Scan(target); err != nil {
			t.Fatalf("%s: %v", query, err)
		}
	}
	if upcoming == 0 || summary == 0 || memberships == 0 || history == 0 || platform != 1 {
		t.Fatalf("unexpected view counts upcoming=%d summary=%d memberships=%d history=%d platform=%d",
			upcoming, summary, memberships, history, platform)
	}

	var confirmed int
	if err := testPool.QueryRow(ctx, `
		SELECT confirmed_registrations FROM upcoming_events ORDER BY event_date LIMIT 1
	`).Scan(&confirmed); err != nil {
		t.Fatalf("upcoming_events seat roll-up: %v", err)
	}

	var eventID int64
	var present, absent, feedbackCount int
	var average *float64
	if err := testPool.QueryRow(ctx, `
		SELECT e.event_id
		FROM events e
		WHERE e.status = 'completed'
		  AND EXISTS (SELECT 1 FROM attendance a JOIN registrations r ON r.registration_id = a.registration_id WHERE r.event_id = e.event_id)
		ORDER BY e.event_date DESC
		LIMIT 1
	`).Scan(&eventID); err != nil {
		t.Fatalf("find completed event: %v", err)
	}
	if err := testPool.QueryRow(ctx, `
		SELECT present_count, absent_count, feedback_count, average_rating
		FROM fn_event_stats($1)
	`, eventID).Scan(&present, &absent, &feedbackCount, &average); err != nil {
		t.Fatalf("fn_event_stats: %v", err)
	}
	if present == 0 {
		t.Fatalf("completed event %d should have present attendees", eventID)
	}

	indexes := []string{
		"idx_events_status_date", "idx_events_date", "idx_registrations_event_status",
		"idx_registrations_student", "idx_club_members_club_status", "idx_feedback_event",
	}
	for _, index := range indexes {
		var exists bool
		if err := testPool.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1)
		`, index).Scan(&exists); err != nil {
			t.Fatalf("check index %s: %v", index, err)
		}
		if !exists {
			t.Fatalf("expected index %s", index)
		}
	}
}

func TestSQLConstraintsAndTriggers(t *testing.T) {
	resetSeed(t)
	ctx := context.Background()

	expectPgError(t, ctx, "23505",
		`INSERT INTO students (user_id, department_id, full_name, enrollment_number)
		 SELECT user_id, department_id, 'Duplicate Student', enrollment_number
		 FROM students ORDER BY student_id LIMIT 1`)

	expectPgError(t, ctx, "23514",
		`INSERT INTO feedback (student_id, event_id, rating, comments)
		 SELECT r.student_id, r.event_id, 6, 'out of range'
		 FROM registrations r
		 WHERE NOT EXISTS (
			SELECT 1 FROM feedback f WHERE f.student_id = r.student_id AND f.event_id = r.event_id
		 )
		 LIMIT 1`)

	expectPgError(t, ctx, "23514",
		`INSERT INTO attendance (registration_id, attendance_status)
		 SELECT registration_id, 'present' FROM registrations
		 WHERE status = 'cancelled' LIMIT 1`)

	expectPgError(t, ctx, "23514", `
		INSERT INTO events (club_id, venue_id, title, event_date, registration_deadline, capacity, status)
		SELECT c.club_id, v.venue_id, 'Venue overflow',
		       CURRENT_TIMESTAMP + INTERVAL '10 days',
		       CURRENT_TIMESTAMP + INTERVAL '8 days',
		       v.capacity + 1, 'pending'
		FROM clubs c, venues v
		WHERE c.name = 'Coding Club' AND v.name = 'Innovation Lab'
	`)

	// The capacity trigger is the database-level guard behind the API
	// transaction; the second confirmed insert must fail.
	tx, err := testPool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin capacity tx: %v", err)
	}
	defer tx.Rollback(ctx)

	expectPgErrorInTx(t, ctx, tx, "23514", `
		WITH new_event AS (
			INSERT INTO events (club_id, venue_id, title, event_date, registration_deadline, capacity, status)
			SELECT c.club_id, v.venue_id, 'Capacity trigger test',
			       CURRENT_TIMESTAMP + INTERVAL '10 days',
			       CURRENT_TIMESTAMP + INTERVAL '8 days',
			       1, 'published'
			FROM clubs c, venues v
			WHERE c.name = 'Coding Club' AND v.name = 'Innovation Lab'
			RETURNING event_id
		), first_student AS (
			SELECT student_id FROM students ORDER BY student_id LIMIT 1
		), second_student AS (
			SELECT student_id FROM students ORDER BY student_id OFFSET 1 LIMIT 1
		), first_insert AS (
			INSERT INTO registrations (student_id, event_id, status)
			SELECT first_student.student_id, new_event.event_id, 'confirmed'
			FROM first_student, new_event
		)
		INSERT INTO registrations (student_id, event_id, status)
		SELECT second_student.student_id, new_event.event_id, 'confirmed'
		FROM second_student, new_event
	`)
	_ = tx.Rollback(ctx)

	// Attendance -> certificate trigger is idempotent.
	var registrationID int64
	if err := testPool.QueryRow(ctx, `
		SELECT r.registration_id
		FROM registrations r
		JOIN events e ON e.event_id = r.event_id
		WHERE e.status = 'completed' AND r.status = 'confirmed'
		ORDER BY r.registration_id LIMIT 1
	`).Scan(&registrationID); err != nil {
		t.Fatalf("find registration: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
		INSERT INTO attendance (registration_id, attendance_status)
		VALUES ($1, 'present')
		ON CONFLICT (registration_id) DO UPDATE SET attendance_status = 'present'
	`, registrationID); err != nil {
		t.Fatalf("mark attendance: %v", err)
	}
	if _, err := testPool.Exec(ctx, `
		UPDATE attendance SET attendance_status = 'present' WHERE registration_id = $1
	`, registrationID); err != nil {
		t.Fatalf("re-mark attendance: %v", err)
	}
	var certificateCount int
	if err := testPool.QueryRow(ctx,
		`SELECT COUNT(*) FROM certificates WHERE registration_id = $1`, registrationID,
	).Scan(&certificateCount); err != nil {
		t.Fatalf("count certificates: %v", err)
	}
	if certificateCount != 1 {
		t.Fatalf("certificate trigger should be idempotent, got %d rows", certificateCount)
	}
	var awarded int
	if err := testPool.QueryRow(ctx,
		`SELECT COUNT(*) FROM fn_award_certificate($1)`, registrationID,
	).Scan(&awarded); err != nil {
		t.Fatalf("fn_award_certificate: %v", err)
	}
	if awarded != 1 {
		t.Fatalf("fn_award_certificate should return the existing certificate, got %d", awarded)
	}

	// updated_at trigger.
	var before, after time.Time
	if err := testPool.QueryRow(ctx,
		`SELECT updated_at FROM clubs WHERE name = 'Coding Club'`,
	).Scan(&before); err != nil {
		t.Fatalf("read updated_at: %v", err)
	}
	time.Sleep(10 * time.Millisecond)
	if err := testPool.QueryRow(ctx, `
		UPDATE clubs SET description = description WHERE name = 'Coding Club' RETURNING updated_at
	`).Scan(&after); err != nil {
		t.Fatalf("touch club: %v", err)
	}
	if !after.After(before) {
		t.Fatalf("updated_at trigger did not advance: before=%s after=%s", before, after)
	}
}

func TestSQLTransactionRollbackAndConcurrencyGuard(t *testing.T) {
	resetSeed(t)
	ctx := context.Background()

	var clubID, venueID int64
	if err := testPool.QueryRow(ctx, `
		SELECT c.club_id, v.venue_id FROM clubs c, venues v
		WHERE c.name = 'Coding Club' AND v.name = 'Innovation Lab'
	`).Scan(&clubID, &venueID); err != nil {
		t.Fatalf("resolve club and venue: %v", err)
	}

	var eventID int64
	var title string
	tx, err := testPool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if err := tx.QueryRow(ctx, `
		INSERT INTO events (club_id, venue_id, title, event_date, registration_deadline, capacity, status)
		VALUES ($1, $2, 'Rollback demo', CURRENT_TIMESTAMP + INTERVAL '10 days',
		        CURRENT_TIMESTAMP + INTERVAL '8 days', 30, 'published')
		RETURNING event_id
	`, clubID, venueID).Scan(&eventID); err != nil {
		t.Fatalf("insert in tx: %v", err)
	}
	// SELECT ... FOR UPDATE is the lock used by the registration transaction.
	if err := tx.QueryRow(ctx, `
		SELECT title FROM events WHERE event_id = $1 FOR UPDATE
	`, eventID).Scan(&title); err != nil {
		t.Fatalf("lock event: %v", err)
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	var exists bool
	if err := testPool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM events WHERE title = 'Rollback demo')`,
	).Scan(&exists); err != nil {
		t.Fatalf("check rollback: %v", err)
	}
	if exists {
		t.Fatal("rolled-back event should not exist")
	}
}

func expectPgError(t *testing.T, ctx context.Context, code string, query string, args ...any) {
	t.Helper()
	tx, err := testPool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx)
	expectPgErrorInTx(t, ctx, tx, code, query, args...)
}

func expectPgErrorInTx(t *testing.T, ctx context.Context, tx interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}, code string, query string, args ...any) {
	t.Helper()
	_, err := tx.Exec(ctx, query, args...)
	if err == nil {
		t.Fatalf("expected SQLSTATE %s, statement succeeded", code)
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("expected PostgreSQL error %s, got %v", code, err)
	}
	if pgErr.Code != code {
		t.Fatalf("expected SQLSTATE %s, got %s (%s)", code, pgErr.Code, pgErr.Message)
	}
}
