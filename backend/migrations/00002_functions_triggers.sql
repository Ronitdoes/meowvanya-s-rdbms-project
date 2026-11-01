-- +goose Up
-- +goose StatementBegin

-- Keep updated_at columns accurate without relying on application code.
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_students_set_updated_at
    BEFORE UPDATE ON students
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_clubs_set_updated_at
    BEFORE UPDATE ON clubs
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_events_set_updated_at
    BEFORE UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- An event can never be given more seats than its venue can physically hold.
CREATE OR REPLACE FUNCTION fn_validate_event_venue_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    venue_capacity INTEGER;
BEGIN
    SELECT capacity INTO venue_capacity
    FROM venues
    WHERE venue_id = NEW.venue_id;

    IF venue_capacity IS NULL THEN
        RAISE EXCEPTION 'venue % does not exist', NEW.venue_id
            USING ERRCODE = '23503';
    END IF;

    IF NEW.capacity > venue_capacity THEN
        RAISE EXCEPTION 'event capacity (%) exceeds venue capacity (%)', NEW.capacity, venue_capacity
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_events_validate_venue_capacity
    BEFORE INSERT OR UPDATE OF capacity, venue_id ON events
    FOR EACH ROW EXECUTE FUNCTION fn_validate_event_venue_capacity();

-- Defence-in-depth: even if application code is bypassed, confirmed
-- registrations cannot exceed event capacity. The event row is locked so
-- concurrent inserters serialize on the same capacity counter.
CREATE OR REPLACE FUNCTION fn_enforce_event_capacity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    event_capacity INTEGER;
    confirmed_count INTEGER;
BEGIN
    IF NEW.status <> 'confirmed' THEN
        RETURN NEW;
    END IF;

    SELECT capacity INTO event_capacity
    FROM events
    WHERE event_id = NEW.event_id
    FOR UPDATE;

    IF event_capacity IS NULL THEN
        RAISE EXCEPTION 'event % does not exist', NEW.event_id
            USING ERRCODE = '23503';
    END IF;

    SELECT COUNT(*) INTO confirmed_count
    FROM registrations
    WHERE event_id = NEW.event_id
      AND status = 'confirmed'
      AND registration_id <> COALESCE(NEW.registration_id, 0);

    IF confirmed_count >= event_capacity THEN
        RAISE EXCEPTION 'event % is at capacity', NEW.event_id
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_registrations_enforce_capacity
    BEFORE INSERT OR UPDATE OF status, event_id ON registrations
    FOR EACH ROW EXECUTE FUNCTION fn_enforce_event_capacity();

-- Attendance only makes sense for a confirmed registration.
CREATE OR REPLACE FUNCTION fn_validate_attendance_registration()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    registration_status TEXT;
BEGIN
    SELECT status INTO registration_status
    FROM registrations
    WHERE registration_id = NEW.registration_id;

    IF registration_status IS DISTINCT FROM 'confirmed' THEN
        RAISE EXCEPTION 'attendance requires a confirmed registration'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_attendance_validate_registration
    BEFORE INSERT OR UPDATE OF registration_id ON attendance
    FOR EACH ROW EXECUTE FUNCTION fn_validate_attendance_registration();

-- Marking a student present automatically issues a certificate. The unique
-- constraint on registration_id makes this trigger idempotent.
CREATE OR REPLACE FUNCTION fn_issue_certificate_for_attendance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.attendance_status = 'present' THEN
        INSERT INTO certificates (registration_id, certificate_code, issue_date)
        VALUES (
            NEW.registration_id,
            'CC-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(NEW.registration_id::text, 6, '0'),
            CURRENT_DATE
        )
        ON CONFLICT (registration_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_attendance_issue_certificate
    AFTER INSERT OR UPDATE OF attendance_status ON attendance
    FOR EACH ROW EXECUTE FUNCTION fn_issue_certificate_for_attendance();

-- Backfill/manual issuance helper used by coordinators. Returns the existing
-- certificate when one already exists, so it is safe to retry.
CREATE OR REPLACE FUNCTION fn_award_certificate(p_registration_id BIGINT)
RETURNS TABLE (certificate_id BIGINT, certificate_code TEXT, issue_date DATE)
LANGUAGE plpgsql
AS $$
DECLARE
    v_attendance_status TEXT;
    v_code TEXT;
BEGIN
    SELECT a.attendance_status INTO v_attendance_status
    FROM attendance a
    WHERE a.registration_id = p_registration_id;

    IF v_attendance_status IS NULL THEN
        RAISE EXCEPTION 'registration % has no attendance record', p_registration_id
            USING ERRCODE = '23514';
    END IF;

    IF v_attendance_status <> 'present' THEN
        RAISE EXCEPTION 'certificates are only issued for present attendance'
            USING ERRCODE = '23514';
    END IF;

    v_code := 'CC-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(p_registration_id::text, 6, '0');

    INSERT INTO certificates AS c (registration_id, certificate_code, issue_date)
    VALUES (p_registration_id, v_code, CURRENT_DATE)
    ON CONFLICT (registration_id) DO NOTHING;

    RETURN QUERY
    SELECT c.certificate_id, c.certificate_code::TEXT, c.issue_date
    FROM certificates c
    WHERE c.registration_id = p_registration_id;
END;
$$;

-- Aggregated statistics used by coordinator dashboards.
CREATE OR REPLACE FUNCTION fn_event_stats(p_event_id BIGINT)
RETURNS TABLE (
    event_id BIGINT,
    title TEXT,
    capacity INTEGER,
    total_registrations INTEGER,
    confirmed_registrations INTEGER,
    cancelled_registrations INTEGER,
    present_count INTEGER,
    absent_count INTEGER,
    average_rating NUMERIC(3, 2),
    feedback_count INTEGER
)
LANGUAGE SQL
STABLE
AS $$
    SELECT
        e.event_id,
        e.title,
        e.capacity,
        COUNT(r.registration_id)::INTEGER,
        COUNT(r.registration_id) FILTER (WHERE r.status = 'confirmed')::INTEGER,
        COUNT(r.registration_id) FILTER (WHERE r.status = 'cancelled')::INTEGER,
        COUNT(a.attendance_id) FILTER (WHERE a.attendance_status = 'present')::INTEGER,
        COUNT(a.attendance_id) FILTER (WHERE a.attendance_status = 'absent')::INTEGER,
        ROUND(AVG(f.rating), 2),
        COUNT(DISTINCT f.feedback_id)::INTEGER
    FROM events e
    LEFT JOIN registrations r ON r.event_id = e.event_id
    LEFT JOIN attendance a ON a.registration_id = r.registration_id
    LEFT JOIN feedback f ON f.event_id = e.event_id
    WHERE e.event_id = p_event_id
    GROUP BY e.event_id, e.title, e.capacity;
$$;

COMMENT ON FUNCTION fn_event_stats(BIGINT) IS 'Per-event registration, attendance and feedback statistics';
COMMENT ON FUNCTION fn_award_certificate(BIGINT) IS 'Idempotently issues a certificate for a present registration';

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP FUNCTION IF EXISTS fn_event_stats(BIGINT);
DROP FUNCTION IF EXISTS fn_award_certificate(BIGINT);
DROP TRIGGER IF EXISTS trg_attendance_issue_certificate ON attendance;
DROP FUNCTION IF EXISTS fn_issue_certificate_for_attendance();
DROP TRIGGER IF EXISTS trg_attendance_validate_registration ON attendance;
DROP FUNCTION IF EXISTS fn_validate_attendance_registration();
DROP TRIGGER IF EXISTS trg_registrations_enforce_capacity ON registrations;
DROP FUNCTION IF EXISTS fn_enforce_event_capacity();
DROP TRIGGER IF EXISTS trg_events_validate_venue_capacity ON events;
DROP FUNCTION IF EXISTS fn_validate_event_venue_capacity();
DROP TRIGGER IF EXISTS trg_events_set_updated_at ON events;
DROP TRIGGER IF EXISTS trg_clubs_set_updated_at ON clubs;
DROP TRIGGER IF EXISTS trg_students_set_updated_at ON students;
DROP TRIGGER IF EXISTS trg_users_set_updated_at ON users;
DROP FUNCTION IF EXISTS fn_set_updated_at();
-- +goose StatementEnd
