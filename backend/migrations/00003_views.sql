-- +goose Up
-- +goose StatementBegin

-- Published future events with live seat availability.
CREATE VIEW upcoming_events AS
SELECT
    e.event_id,
    e.title,
    e.description,
    e.event_date,
    e.registration_deadline,
    e.capacity,
    c.club_id,
    c.name AS club_name,
    v.venue_id,
    v.name AS venue_name,
    v.location AS venue_location,
    COUNT(r.registration_id) FILTER (WHERE r.status = 'confirmed')::INTEGER AS confirmed_registrations,
    (e.capacity - COUNT(r.registration_id) FILTER (WHERE r.status = 'confirmed'))::INTEGER AS seats_remaining
FROM events AS e
JOIN clubs AS c ON c.club_id = e.club_id
JOIN venues AS v ON v.venue_id = e.venue_id
LEFT JOIN registrations AS r ON r.event_id = e.event_id
WHERE e.event_date >= CURRENT_TIMESTAMP
  AND e.status = 'published'
GROUP BY e.event_id, e.title, e.description, e.event_date, e.registration_deadline,
         e.capacity, c.club_id, c.name, v.venue_id, v.name, v.location;

-- Registration, attendance and feedback roll-up per event.
CREATE VIEW event_registration_summary AS
SELECT
    e.event_id,
    e.title,
    e.status,
    e.event_date,
    e.capacity,
    c.name AS club_name,
    v.name AS venue_name,
    COUNT(DISTINCT r.registration_id)::INTEGER AS total_registrations,
    COUNT(DISTINCT r.registration_id) FILTER (WHERE r.status = 'confirmed')::INTEGER AS confirmed_registrations,
    COUNT(DISTINCT a.attendance_id) FILTER (WHERE a.attendance_status = 'present')::INTEGER AS present_count,
    COUNT(DISTINCT f.feedback_id)::INTEGER AS feedback_count,
    ROUND(AVG(f.rating), 2) AS average_rating
FROM events AS e
JOIN clubs AS c ON c.club_id = e.club_id
JOIN venues AS v ON v.venue_id = e.venue_id
LEFT JOIN registrations AS r ON r.event_id = e.event_id
LEFT JOIN attendance AS a ON a.registration_id = r.registration_id
LEFT JOIN feedback AS f ON f.event_id = e.event_id
GROUP BY e.event_id, e.title, e.status, e.event_date, e.capacity, c.name, v.name;

-- Approved, pending and total membership counts per club.
CREATE VIEW club_membership_summary AS
SELECT
    c.club_id,
    c.name,
    c.status,
    COUNT(cm.membership_id) FILTER (WHERE cm.status = 'approved')::INTEGER AS approved_members,
    COUNT(cm.membership_id) FILTER (WHERE cm.status = 'pending')::INTEGER AS pending_requests,
    COUNT(cm.membership_id)::INTEGER AS total_requests,
    COUNT(cm.membership_id) FILTER (WHERE cm.role = 'coordinator' AND cm.status = 'approved')::INTEGER AS coordinator_count
FROM clubs AS c
LEFT JOIN club_members AS cm ON cm.club_id = c.club_id
GROUP BY c.club_id, c.name, c.status;

-- Flattened per-student registration history with attendance and certificate.
CREATE VIEW student_registration_history AS
SELECT
    s.student_id,
    s.full_name,
    s.enrollment_number,
    r.registration_id,
    r.status AS registration_status,
    r.registered_at,
    e.event_id,
    e.title AS event_title,
    e.event_date,
    c.name AS club_name,
    COALESCE(a.attendance_status, 'not_marked') AS attendance_status,
    cert.certificate_code,
    cert.issue_date
FROM students AS s
JOIN registrations AS r ON r.student_id = s.student_id
JOIN events AS e ON e.event_id = r.event_id
JOIN clubs AS c ON c.club_id = e.club_id
LEFT JOIN attendance AS a ON a.registration_id = r.registration_id
LEFT JOIN certificates AS cert ON cert.registration_id = r.registration_id;

-- Single-row platform snapshot for the admin dashboard.
CREATE VIEW platform_stats AS
SELECT
    (SELECT COUNT(*) FROM users)::INTEGER AS total_users,
    (SELECT COUNT(*) FROM students)::INTEGER AS total_students,
    (SELECT COUNT(*) FROM clubs)::INTEGER AS total_clubs,
    (SELECT COUNT(*) FROM clubs WHERE status = 'approved')::INTEGER AS approved_clubs,
    (SELECT COUNT(*) FROM events)::INTEGER AS total_events,
    (SELECT COUNT(*) FROM events WHERE status = 'published')::INTEGER AS published_events,
    (SELECT COUNT(*) FROM registrations WHERE status = 'confirmed')::INTEGER AS confirmed_registrations,
    (SELECT COUNT(*) FROM certificates)::INTEGER AS certificates_issued,
    (SELECT COALESCE(ROUND(AVG(rating), 2), 0) FROM feedback) AS average_feedback_rating;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP VIEW IF EXISTS platform_stats;
DROP VIEW IF EXISTS student_registration_history;
DROP VIEW IF EXISTS club_membership_summary;
DROP VIEW IF EXISTS event_registration_summary;
DROP VIEW IF EXISTS upcoming_events;
-- +goose StatementEnd
