-- ============================================================================
-- CampusConnect — PostgreSQL Demonstration Script
-- ============================================================================
-- Target : PostgreSQL 15+ (Neon PostgreSQL compatible)
-- Prereq : migrations 00001_schema.sql, 00002_functions_triggers.sql,
--          00003_views.sql and seeds/seed.sql have been applied.
--
-- Run:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -f docs/sql-queries.sql
--
-- IMPORTANT
--   Some sections intentionally provoke constraint errors (they are labelled
--   "[EXPECTED ERROR]"). ON_ERROR_STOP is therefore disabled so psql can
--   continue. Every data-changing statement is wrapped in BEGIN/ROLLBACK, so
--   the script is read-only in effect. Run it against a development database,
--   never against production data.
--
-- Conventions
--   * All identifiers are lower-case snake_case, matching the migrations.
--   * $1-style placeholders are used by the Go repositories; psql demos use
--     psql variables (\gset) only where a value must be reused.
--   * "Qn" numbers every runnable statement group for the evaluation.
-- ============================================================================

\set ON_ERROR_STOP off
\pset pager off

-- ============================================================================
-- SECTION 1 — CATALOGUE AND BASIC RETRIEVAL
-- ============================================================================

-- Q1. Schema inventory: list every table and view with its column count.
--     Demonstrates the data dictionary living in the PostgreSQL catalogue.
SELECT c.relname AS object_name,
       CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' END AS object_type,
       COUNT(a.attname) AS column_count
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
LEFT JOIN pg_attribute AS a
       ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'v')
  AND c.relname IN (
      'users', 'departments', 'students', 'clubs', 'club_members', 'venues',
      'events', 'registrations', 'attendance', 'feedback', 'certificates',
      'upcoming_events', 'event_registration_summary',
      'club_membership_summary', 'student_registration_history', 'platform_stats'
  )
GROUP BY c.relname, c.relkind
ORDER BY object_type, object_name;

-- Q2. Filtering and ordering: approved clubs whose name or description
--     matches a search term. ILIKE is PostgreSQL's case-insensitive LIKE.
SELECT club_id, name, status, created_at
FROM clubs
WHERE status = 'approved'
  AND (name ILIKE '%club%' OR description ILIKE '%club%')
ORDER BY name ASC;

-- Q3. INNER JOIN across three tables: each event with its club and venue.
--     INNER JOIN drops events whose club or venue is missing (impossible here
--     because both foreign keys are NOT NULL).
SELECT e.event_id,
       e.title,
       c.name       AS club_name,
       v.name       AS venue_name,
       v.capacity   AS venue_capacity,
       e.capacity   AS event_capacity,
       e.event_date,
       e.status
FROM events AS e
JOIN clubs  AS c ON c.club_id  = e.club_id
JOIN venues AS v ON v.venue_id = e.venue_id
ORDER BY e.event_date;

-- Q4. Five-table INNER JOIN: a complete registration row with student,
--     department, event, club and venue. This is the shape the API returns.
SELECT r.registration_id,
       s.full_name          AS student_name,
       s.enrollment_number,
       d.name               AS department_name,
       e.title              AS event_title,
       c.name               AS club_name,
       v.name               AS venue_name,
       r.status,
       r.registered_at
FROM registrations AS r
JOIN students    AS s ON s.student_id    = r.student_id
JOIN departments AS d ON d.department_id = s.department_id
JOIN events      AS e ON e.event_id      = r.event_id
JOIN clubs       AS c ON c.club_id       = e.club_id
JOIN venues      AS v ON v.venue_id      = e.venue_id
ORDER BY r.registered_at DESC
LIMIT 20;

-- Q5. LEFT JOIN + aggregate: every approved club, including clubs with no
--     members. COUNT(cm.membership_id) returns 0 (not 1) for empty clubs,
--     which is the classic LEFT JOIN counting pitfall.
SELECT c.club_id,
       c.name,
       COUNT(cm.membership_id)                                   AS total_requests,
       COUNT(cm.membership_id) FILTER (WHERE cm.status = 'approved') AS approved_members,
       COUNT(cm.membership_id) FILTER (WHERE cm.status = 'pending')  AS pending_requests
FROM clubs AS c
LEFT JOIN club_members AS cm ON cm.club_id = c.club_id
WHERE c.status = 'approved'
GROUP BY c.club_id, c.name
ORDER BY approved_members DESC, c.name;

-- Q6. LEFT JOIN + IS NULL (anti-join): events that have never received a
--     registration. Useful to find events that need promotion.
SELECT e.event_id, e.title, e.status, e.event_date
FROM events AS e
LEFT JOIN registrations AS r ON r.event_id = e.event_id
WHERE r.registration_id IS NULL
ORDER BY e.event_date;

-- Q7. GROUP BY with conditional aggregation (FILTER): one row per event with
--     confirmed, cancelled and waitlisted counts side by side.
SELECT e.event_id,
       e.title,
       e.capacity,
       COUNT(r.registration_id)                                      AS total_registrations,
       COUNT(r.registration_id) FILTER (WHERE r.status = 'confirmed') AS confirmed,
       COUNT(r.registration_id) FILTER (WHERE r.status = 'cancelled') AS cancelled,
       COUNT(r.registration_id) FILTER (WHERE r.status = 'waitlisted') AS waitlisted
FROM events AS e
LEFT JOIN registrations AS r ON r.event_id = e.event_id
GROUP BY e.event_id, e.title, e.capacity
ORDER BY confirmed DESC, e.title;

-- Q8. HAVING: keep only groups that satisfy an aggregate predicate. HAVING
--     runs after GROUP BY, so it can filter on COUNT.
SELECT e.title, COUNT(r.registration_id) AS confirmed_registrations
FROM events AS e
JOIN registrations AS r
  ON r.event_id = e.event_id
 AND r.status = 'confirmed'
GROUP BY e.event_id, e.title
HAVING COUNT(r.registration_id) >= 10
ORDER BY confirmed_registrations DESC;

-- Q9. Aggregate functions: average, min, max and count of feedback per event.
--     LEFT JOIN keeps events with no feedback; AVG ignores NULL ratings.
SELECT e.event_id,
       e.title,
       COUNT(f.feedback_id)          AS feedback_count,
       ROUND(AVG(f.rating), 2)       AS average_rating,
       MIN(f.rating)                 AS lowest_rating,
       MAX(f.rating)                 AS highest_rating
FROM events AS e
LEFT JOIN feedback AS f ON f.event_id = e.event_id
GROUP BY e.event_id, e.title
ORDER BY average_rating DESC NULLS LAST;

-- Q10. Non-correlated subquery: students whose confirmed-registration count is
--      strictly above the platform-wide average. The subquery is evaluated
--      once and compared against each outer row.
SELECT s.student_id,
       s.full_name,
       d.name AS department,
       per_student.confirmed_count
FROM students AS s
JOIN departments AS d ON d.department_id = s.department_id
JOIN (
    SELECT student_id, COUNT(*) AS confirmed_count
    FROM registrations
    WHERE status = 'confirmed'
    GROUP BY student_id
) AS per_student ON per_student.student_id = s.student_id
WHERE per_student.confirmed_count > (
    SELECT AVG(cnt)
    FROM (
        SELECT COUNT(*) AS cnt
        FROM registrations
        WHERE status = 'confirmed'
        GROUP BY student_id
    ) AS counts
)
ORDER BY per_student.confirmed_count DESC, s.full_name;

-- Q11. Correlated subquery: compare each student with the average number of
--      registrations inside their own department. The inner query references
--      s.department_id, so it is re-evaluated per outer row (conceptually).
SELECT s.student_id,
       s.full_name,
       d.name AS department,
       (SELECT COUNT(*)
        FROM registrations AS r
        WHERE r.student_id = s.student_id) AS total_registrations
FROM students AS s
JOIN departments AS d ON d.department_id = s.department_id
WHERE (SELECT COUNT(*)
       FROM registrations AS r
       WHERE r.student_id = s.student_id) > (
           SELECT AVG(dept_counts.cnt)
           FROM (
               SELECT COUNT(r2.registration_id) AS cnt
               FROM students AS s2
               LEFT JOIN registrations AS r2 ON r2.student_id = s2.student_id
               WHERE s2.department_id = s.department_id
               GROUP BY s2.student_id
           ) AS dept_counts
       )
ORDER BY total_registrations DESC, s.full_name;

-- Q12. EXISTS (semi-join): students who hold at least one certificate.
--      EXISTS stops at the first matching row, so it is cheaper than COUNT > 0.
SELECT s.student_id, s.full_name, s.enrollment_number
FROM students AS s
WHERE EXISTS (
    SELECT 1
    FROM registrations AS r
    JOIN certificates  AS cert ON cert.registration_id = r.registration_id
    WHERE r.student_id = s.student_id
)
ORDER BY s.full_name;

-- Q13. NOT EXISTS (anti-join): approved clubs with no published upcoming
--      event, i.e. clubs that may need a programme.
SELECT c.club_id, c.name
FROM clubs AS c
WHERE c.status = 'approved'
  AND NOT EXISTS (
      SELECT 1
      FROM events AS e
      WHERE e.club_id = c.club_id
        AND e.status = 'published'
        AND e.event_date >= CURRENT_TIMESTAMP
  )
ORDER BY c.name;

-- Q14. Derived table (subquery in FROM): compute event fill rate before
--      filtering it. Aliases and explicit casts keep numeric division precise.
SELECT fill.event_id,
       fill.title,
       fill.confirmed_registrations,
       fill.capacity,
       ROUND(100.0 * fill.confirmed_registrations / fill.capacity, 1) AS fill_percent
FROM (
    SELECT e.event_id,
           e.title,
           e.capacity,
           COUNT(r.registration_id) FILTER (WHERE r.status = 'confirmed') AS confirmed_registrations
    FROM events AS e
    LEFT JOIN registrations AS r ON r.event_id = e.event_id
    GROUP BY e.event_id, e.title, e.capacity
) AS fill
WHERE fill.confirmed_registrations > 0
ORDER BY fill_percent DESC, fill.title;

-- Q15. CTE (WITH): staged reporting query. The first CTE aggregates
--      registrations, the second aggregates feedback, and the final SELECT
--      joins both to events. CTEs make multi-step reporting readable.
WITH registration_counts AS (
    SELECT event_id,
           COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
           COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled
    FROM registrations
    GROUP BY event_id
),
feedback_counts AS (
    SELECT event_id, COUNT(*) AS feedback_count, ROUND(AVG(rating), 2) AS average_rating
    FROM feedback
    GROUP BY event_id
)
SELECT e.event_id,
       e.title,
       e.status,
       COALESCE(rc.confirmed, 0)                    AS confirmed_registrations,
       COALESCE(rc.cancelled, 0)                    AS cancelled_registrations,
       COALESCE(fc.feedback_count, 0)               AS feedback_count,
       COALESCE(fc.average_rating, 0)               AS average_rating,
       (e.capacity - COALESCE(rc.confirmed, 0))     AS seats_remaining
FROM events AS e
LEFT JOIN registration_counts AS rc ON rc.event_id = e.event_id
LEFT JOIN feedback_counts     AS fc ON fc.event_id = e.event_id
WHERE e.status IN ('published', 'completed')
ORDER BY e.event_date;

-- Q16. Chained CTEs with a ratio: membership approval funnel per club.
WITH club_requests AS (
    SELECT club_id,
           COUNT(*) FILTER (WHERE status = 'approved') AS approved,
           COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
           COUNT(*)                                    AS total
    FROM club_members
    GROUP BY club_id
)
SELECT c.name,
       cr.approved,
       cr.rejected,
       cr.total,
       ROUND(100.0 * cr.approved / NULLIF(cr.total, 0), 1) AS approval_rate_percent
FROM clubs AS c
JOIN club_requests AS cr ON cr.club_id = c.club_id
ORDER BY approval_rate_percent DESC NULLS LAST, c.name;

-- ============================================================================
-- SECTION 2 — WINDOW FUNCTIONS
-- ============================================================================

-- Q17. ROW_NUMBER: rank students inside each department by confirmed
--      registrations. PARTITION BY restarts the numbering per department.
WITH per_student AS (
    SELECT s.student_id,
           s.full_name,
           s.department_id,
           COUNT(r.registration_id) FILTER (WHERE r.status = 'confirmed') AS confirmed
    FROM students AS s
    LEFT JOIN registrations AS r ON r.student_id = s.student_id
    GROUP BY s.student_id, s.full_name, s.department_id
)
SELECT d.name AS department,
       ps.full_name,
       ps.confirmed,
       ROW_NUMBER() OVER (PARTITION BY ps.department_id ORDER BY ps.confirmed DESC, ps.full_name) AS dept_rank
FROM per_student AS ps
JOIN departments AS d ON d.department_id = ps.department_id
ORDER BY d.name, dept_rank;

-- Q18. RANK and DENSE_RANK: rank events by confirmed registrations. Ties share
--      a rank; RANK leaves a gap after a tie while DENSE_RANK does not.
SELECT e.title,
       COUNT(r.registration_id) FILTER (WHERE r.status = 'confirmed') AS confirmed,
       RANK()       OVER (ORDER BY COUNT(r.registration_id) FILTER (WHERE r.status = 'confirmed') DESC) AS rank_position,
       DENSE_RANK() OVER (ORDER BY COUNT(r.registration_id) FILTER (WHERE r.status = 'confirmed') DESC) AS dense_position
FROM events AS e
LEFT JOIN registrations AS r ON r.event_id = e.event_id
GROUP BY e.event_id, e.title
ORDER BY confirmed DESC, e.title;

-- Q19. Window aggregate: daily registrations plus a running total and each
--      day's share of all registrations. The window is not the GROUP BY.
SELECT DATE_TRUNC('day', registered_at)::date AS registration_day,
       COUNT(*) AS registrations,
       SUM(COUNT(*)) OVER (ORDER BY DATE_TRUNC('day', registered_at)) AS running_total,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1)             AS percent_of_total
FROM registrations
GROUP BY DATE_TRUNC('day', registered_at)
ORDER BY registration_day;

-- Q20. LAG: days between consecutive events for each club. LAG reads the
--      previous row in the window without a self-join.
WITH ordered_events AS (
    SELECT club_id,
           title,
           event_date,
           LAG(event_date) OVER (PARTITION BY club_id ORDER BY event_date) AS previous_event_date
    FROM events
)
SELECT c.name AS club_name,
       oe.title,
       oe.event_date::date AS event_day,
       oe.previous_event_date::date AS previous_day,
       (oe.event_date::date - oe.previous_event_date::date) AS days_since_previous
FROM ordered_events AS oe
JOIN clubs AS c ON c.club_id = oe.club_id
WHERE oe.previous_event_date IS NOT NULL
ORDER BY c.name, oe.event_date;

-- ============================================================================
-- SECTION 3 — VIEWS
-- ============================================================================

-- Q21. View upcoming_events: published future events with live seat counts.
SELECT event_id, title, club_name, venue_name, event_date,
       capacity, confirmed_registrations, seats_remaining
FROM upcoming_events
ORDER BY event_date;

-- Q22. View event_registration_summary: registration, attendance and feedback
--      roll-up per event.
SELECT event_id, title, status, capacity, club_name,
       total_registrations, confirmed_registrations,
       present_count, feedback_count, average_rating
FROM event_registration_summary
ORDER BY event_date DESC;

-- Q23. View club_membership_summary: approved / pending membership counts.
SELECT club_id, name, status, approved_members, pending_requests,
       total_requests, coordinator_count
FROM club_membership_summary
ORDER BY approved_members DESC;

-- Q24. View student_registration_history: flattened history including
--      attendance ("not_marked" when absent) and certificate code.
SELECT student_id, full_name, event_title, registration_status,
       attendance_status, certificate_code, issue_date
FROM student_registration_history
WHERE student_id = (SELECT MIN(student_id) FROM students)
ORDER BY event_date DESC;

-- Q25. View platform_stats: single-row platform snapshot.
SELECT * FROM platform_stats;

-- ============================================================================
-- SECTION 4 — INDEXES AND QUERY PLANS
-- ============================================================================

-- Q26. EXPLAIN ANALYZE for the event-date lookup. The partial index
--      idx_events_date (event_date) WHERE status = 'published' is the target.
--      enable_seqscan is disabled only for this demonstration so the plan shows
--      the index even on a tiny seeded table. ROLLBACK restores the setting.
BEGIN;
SET LOCAL enable_seqscan = off;
EXPLAIN (ANALYZE, BUFFERS)
SELECT event_id, title, event_date
FROM events
WHERE status = 'published'
  AND event_date >= CURRENT_TIMESTAMP
  AND event_date < CURRENT_TIMESTAMP + INTERVAL '30 days'
ORDER BY event_date;
ROLLBACK;

-- Q27. EXPLAIN ANALYZE for the registration lookup by event and status.
--      idx_registrations_event_status (event_id, status) supports the count
--      performed by the registration transaction and the attendance screen.
BEGIN;
SET LOCAL enable_seqscan = off;
EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*)
FROM registrations
WHERE event_id = (SELECT MAX(event_id) FROM events)
  AND status = 'confirmed';
ROLLBACK;

-- Q28. Index inventory: every explicit and implicit index in the schema.
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- Q29. Unindexed-predicate comparison: ILIKE on lower(full_name) can use
--      idx_students_name because the index is on lower(full_name).
BEGIN;
SET LOCAL enable_seqscan = off;
EXPLAIN (ANALYZE, BUFFERS)
SELECT student_id, full_name
FROM students
WHERE lower(full_name) LIKE 'a%';
ROLLBACK;

-- ============================================================================
-- SECTION 5 — DML (all changes rolled back)
-- ============================================================================

-- Q30. INSERT / UPDATE / DELETE inside one transaction, followed by a count
--      proving the row is gone. ROLLBACK leaves the seed data unchanged.
BEGIN;
INSERT INTO departments (name, code)
VALUES ('Data Science', 'DS')
RETURNING department_id, name, code;

UPDATE departments
SET name = 'Data Science & Artificial Intelligence'
WHERE code = 'DS'
RETURNING department_id, name, code;

DELETE FROM departments
WHERE code = 'DS'
RETURNING department_id, name;

SELECT COUNT(*) AS data_science_rows_left
FROM departments
WHERE code = 'DS';
ROLLBACK;

-- ============================================================================
-- SECTION 6 — CONSTRAINT TESTS (expected errors)
-- ============================================================================
-- Each test is independent. psql prints an error such as
--   ERROR: duplicate key value violates unique constraint "users_email_unique"
--   SQLSTATE: 23505
-- and the following ROLLBACK closes the aborted transaction. Nothing persists.

-- Q31. [EXPECTED ERROR 23505] UNIQUE on users.email.
BEGIN;
INSERT INTO users (email, password_hash, role)
VALUES ('admin@campusconnect.test', 'not-a-real-hash', 'student');
ROLLBACK;

-- Q32. [EXPECTED ERROR 23514] CHECK on users.role (only student/coordinator/admin).
BEGIN;
INSERT INTO users (email, password_hash, role)
VALUES ('invalid-role@campusconnect.test', 'not-a-real-hash', 'superuser');
ROLLBACK;

-- Q33. [EXPECTED ERROR 23514] CHECK feedback_rating_range (1..5).
BEGIN;
INSERT INTO feedback (student_id, event_id, rating, comments)
SELECT s.student_id, e.event_id, 6, 'Rating out of range'
FROM students AS s
CROSS JOIN events AS e
LIMIT 1;
ROLLBACK;

-- Q34. [EXPECTED ERROR 23503] FOREIGN KEY to a department that does not exist.
BEGIN;
INSERT INTO students (user_id, department_id, full_name, enrollment_number)
SELECT u.user_id, 999999, 'Ghost Student', 'GHOST0001'
FROM users AS u
LEFT JOIN students AS existing ON existing.user_id = u.user_id
WHERE existing.student_id IS NULL
ORDER BY u.user_id
LIMIT 1;
ROLLBACK;

-- Q35. [EXPECTED ERROR 23505] UNIQUE (student_id, event_id) on registrations.
--      The row already exists in the seed data.
BEGIN;
INSERT INTO registrations (student_id, event_id, status)
SELECT student_id, event_id, 'confirmed'
FROM registrations
WHERE status = 'confirmed'
LIMIT 1;
ROLLBACK;

-- Q36. [EXPECTED ERROR 23514] club_members_decision_check: an approved row
--      must have decided_at and joined_at.
BEGIN;
INSERT INTO club_members (student_id, club_id, role, status)
SELECT s.student_id, c.club_id, 'member', 'approved'
FROM students AS s
CROSS JOIN clubs AS c
WHERE NOT EXISTS (
    SELECT 1 FROM club_members AS cm
    WHERE cm.student_id = s.student_id AND cm.club_id = c.club_id
)
LIMIT 1;
ROLLBACK;

-- Q37. [EXPECTED ERROR 23514] events_deadline_before_event: the registration
--      deadline cannot fall after the event date.
BEGIN;
UPDATE events
SET registration_deadline = event_date + INTERVAL '1 day'
WHERE event_id = (SELECT MIN(event_id) FROM events);
ROLLBACK;

-- Q38. [EXPECTED ERROR 23503] ON DELETE RESTRICT: a department with students
--      cannot be deleted.
BEGIN;
DELETE FROM departments
WHERE department_id = (SELECT department_id FROM students LIMIT 1);
ROLLBACK;

-- Q39. [EXPECTED ERROR 23503] ON DELETE RESTRICT: an event with registrations
--      cannot be deleted.
BEGIN;
DELETE FROM events
WHERE event_id = (SELECT event_id FROM registrations LIMIT 1);
ROLLBACK;

-- Q40. ON DELETE CASCADE: deleting a user cascades to the student profile when
--      that student has no historical records. Verify the child row vanishes.
BEGIN;
INSERT INTO users (email, password_hash, role)
VALUES ('cascade.demo@campusconnect.test', 'not-a-real-hash', 'student')
RETURNING user_id \gset
INSERT INTO students (user_id, department_id, full_name, enrollment_number)
SELECT :user_id, d.department_id, 'Cascade Demo', 'CASCADE01'
FROM departments AS d
ORDER BY d.department_id
LIMIT 1;
DELETE FROM users WHERE user_id = :user_id;
SELECT COUNT(*) AS student_rows_left
FROM students
WHERE user_id = :user_id;
ROLLBACK;

-- Q41. Trigger trg_events_validate_venue_capacity: an event capacity greater
--      than its venue capacity is rejected by a BEFORE trigger.
--      [EXPECTED ERROR 23514]
BEGIN;
UPDATE events AS e
SET capacity = v.capacity + 1
FROM venues AS v
WHERE v.venue_id = e.venue_id
  AND e.event_id = (SELECT MIN(event_id) FROM events);
ROLLBACK;

-- Q42. Trigger trg_registrations_enforce_capacity: a temporary event with
--      capacity 1 rejects the second confirmed registration. [EXPECTED ERROR 23514]
BEGIN;
INSERT INTO events (club_id, venue_id, title, event_date,
                    registration_deadline, capacity, status)
SELECT c.club_id, v.venue_id, 'Capacity Trigger Demo',
       CURRENT_TIMESTAMP + INTERVAL '30 days',
       CURRENT_TIMESTAMP + INTERVAL '20 days',
       1, 'published'
FROM clubs AS c
JOIN venues AS v ON v.capacity >= 1
WHERE c.status = 'approved'
ORDER BY c.club_id, v.venue_id
LIMIT 1
RETURNING event_id \gset

INSERT INTO registrations (student_id, event_id, status)
SELECT student_id, :event_id, 'confirmed'
FROM students
ORDER BY student_id
LIMIT 1;

-- The second insert must fail: the event is already at capacity.
INSERT INTO registrations (student_id, event_id, status)
SELECT student_id, :event_id, 'confirmed'
FROM students
ORDER BY student_id
OFFSET 1
LIMIT 1;
ROLLBACK;

-- Q43. UNIQUE attendance.registration_id and certificates.registration_id are
--      enforced by the schema. [EXPECTED ERROR 23505]
BEGIN;
INSERT INTO attendance (registration_id, attendance_status)
SELECT registration_id, 'present' FROM attendance LIMIT 1;
ROLLBACK;

-- ============================================================================
-- SECTION 7 — TRANSACTIONS, ROW LOCKS AND TRIGGERS
-- ============================================================================

-- Q44. Capacity-safe registration transaction (the same sequence as the Go
--      repository). SELECT ... FOR UPDATE locks the event row so concurrent
--      registrations for the same event serialize. Everything is rolled back.
BEGIN;

SELECT event_id
FROM events
WHERE title = 'CodeSprint 2026'
\gset

-- Step 1: lock the event row and read its rules atomically.
SELECT event_id, status, capacity,
       registration_deadline >= CURRENT_TIMESTAMP AS deadline_open,
       event_date > CURRENT_TIMESTAMP           AS not_started
FROM events
WHERE event_id = :event_id
FOR UPDATE;

-- Step 2: count confirmed registrations while the lock is held.
SELECT COUNT(*) AS confirmed_before
FROM registrations
WHERE event_id = :event_id AND status = 'confirmed';

-- Step 3: insert for a student who is not already registered.
INSERT INTO registrations (student_id, event_id, status)
SELECT s.student_id, :event_id, 'confirmed'
FROM students AS s
WHERE NOT EXISTS (
    SELECT 1 FROM registrations AS r
    WHERE r.student_id = s.student_id AND r.event_id = :event_id
)
ORDER BY s.student_id
LIMIT 1
RETURNING registration_id, student_id, event_id, status;

-- Step 4: verify the post-condition before committing.
SELECT COUNT(*) AS confirmed_after
FROM registrations
WHERE event_id = :event_id AND status = 'confirmed';

ROLLBACK;

-- Q45. Trigger trg_events_set_updated_at: updated_at is refreshed by the
--      database on UPDATE, independent of application code.
BEGIN;
SELECT club_id, updated_at AS before_update
FROM clubs
WHERE club_id = 1;

UPDATE clubs
SET description = description
WHERE club_id = 1
RETURNING club_id, updated_at AS after_update;
ROLLBACK;

-- Q46. Trigger trg_attendance_issue_certificate: inserting 'present'
--      attendance automatically creates a certificate. The unique constraint
--      on registration_id makes the trigger idempotent.
BEGIN;
SELECT r.registration_id
FROM registrations AS r
LEFT JOIN attendance AS a ON a.registration_id = r.registration_id
WHERE r.status = 'confirmed' AND a.attendance_id IS NULL
ORDER BY r.registration_id
LIMIT 1
\gset

INSERT INTO attendance (registration_id, attendance_status, marked_by)
VALUES (:registration_id, 'present',
        (SELECT user_id FROM users WHERE email = 'admin@campusconnect.test'))
RETURNING attendance_id, registration_id, attendance_status;

SELECT certificate_id, certificate_code, issue_date
FROM certificates
WHERE registration_id = :registration_id;
ROLLBACK;

-- Q47. Trigger trg_attendance_validate_registration: attendance is only valid
--      for a confirmed registration. This cancels one registration first and
--      then attempts attendance. [EXPECTED ERROR 23514]
BEGIN;
SELECT registration_id
FROM registrations
WHERE status = 'confirmed'
ORDER BY registration_id
LIMIT 1
\gset

UPDATE registrations
SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP
WHERE registration_id = :registration_id;

INSERT INTO attendance (registration_id, attendance_status)
VALUES (:registration_id, 'present');
ROLLBACK;

-- ============================================================================
-- SECTION 8 — STORED FUNCTIONS
-- ============================================================================

-- Q48. fn_event_stats(bigint): the same aggregate used by the coordinator
--      statistics endpoint. Returns one row for the requested event.
SELECT *
FROM fn_event_stats((SELECT event_id FROM events WHERE title = 'Hack the Campus 2026'));

-- Q49. fn_event_stats for every event via a LATERAL join.
SELECT e.title, stats.*
FROM events AS e
CROSS JOIN LATERAL fn_event_stats(e.event_id) AS stats
ORDER BY e.event_date;

-- Q50. fn_award_certificate(bigint): idempotent certificate issue. Calling it
--      twice returns the same certificate row. Rolled back afterwards.
BEGIN;
SELECT registration_id
FROM attendance
WHERE attendance_status = 'present'
ORDER BY registration_id
LIMIT 1
\gset

SELECT * FROM fn_award_certificate(:registration_id);
SELECT * FROM fn_award_certificate(:registration_id);
ROLLBACK;

-- ============================================================================
-- SECTION 9 — SECURITY / PRIVILEGES
-- ============================================================================

-- Q51. Least-privilege reporting role. Requires a role with CREATEROLE (usually
--      the local superuser) and is therefore wrapped in a rollback. The role
--      can read the reporting views but not the base tables.
BEGIN;
CREATE ROLE cc_readonly NOLOGIN;
GRANT USAGE ON SCHEMA public TO cc_readonly;
GRANT SELECT ON upcoming_events,
                event_registration_summary,
                club_membership_summary,
                student_registration_history,
                platform_stats
TO cc_readonly;

SET LOCAL ROLE cc_readonly;
SELECT current_user AS effective_user, COUNT(*) AS visible_upcoming_events
FROM upcoming_events;
RESET ROLE;

SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'cc_readonly'
ORDER BY table_name, privilege_type;
ROLLBACK;

-- ============================================================================
-- SECTION 10 — REPORTING EXTRAS
-- ============================================================================

-- Q52. Pagination with a window-function total: one query returns the page and
--      the full count, avoiding a second COUNT round trip.
SELECT e.event_id, e.title, e.event_date,
       COUNT(*) OVER () AS total_rows
FROM events AS e
WHERE e.status = 'published'
ORDER BY e.event_date
LIMIT 5 OFFSET 5;

-- Q53. UNION ALL: a platform-wide entity count in one result set.
SELECT 'users' AS entity, COUNT(*) AS row_count FROM users
UNION ALL SELECT 'students', COUNT(*) FROM students
UNION ALL SELECT 'clubs', COUNT(*) FROM clubs
UNION ALL SELECT 'club_members', COUNT(*) FROM club_members
UNION ALL SELECT 'venues', COUNT(*) FROM venues
UNION ALL SELECT 'events', COUNT(*) FROM events
UNION ALL SELECT 'registrations', COUNT(*) FROM registrations
UNION ALL SELECT 'attendance', COUNT(*) FROM attendance
UNION ALL SELECT 'feedback', COUNT(*) FROM feedback
UNION ALL SELECT 'certificates', COUNT(*) FROM certificates
ORDER BY entity;

-- Q54. CASE expression + date_trunc: registrations grouped by month with a
--      readable activity band.
SELECT DATE_TRUNC('month', registered_at)::date AS month,
       COUNT(*) AS registrations,
       CASE
           WHEN COUNT(*) >= 100 THEN 'high'
           WHEN COUNT(*) >= 30  THEN 'medium'
           ELSE 'low'
       END AS activity_band
FROM registrations
GROUP BY DATE_TRUNC('month', registered_at)
ORDER BY month;

-- Q55. COALESCE and NULL-safe reporting: every confirmed registration with its
--      attendance and certificate status, even when those rows do not exist.
SELECT r.registration_id,
       s.full_name,
       e.title,
       r.status AS registration_status,
       COALESCE(a.attendance_status, 'not_marked') AS attendance_status,
       COALESCE(cert.certificate_code, '—')          AS certificate_code
FROM registrations AS r
JOIN students AS s ON s.student_id = r.student_id
JOIN events   AS e ON e.event_id   = r.event_id
LEFT JOIN attendance   AS a    ON a.registration_id    = r.registration_id
LEFT JOIN certificates AS cert ON cert.registration_id = r.registration_id
WHERE r.status = 'confirmed'
ORDER BY r.registered_at DESC
LIMIT 25;

-- ============================================================================
-- End of demonstration script.
-- Expected clean results: Q1-Q30, Q44-Q46, Q48-Q55.
-- Expected errors: Q31-Q43 and Q47 (each immediately rolled back).
-- ============================================================================
