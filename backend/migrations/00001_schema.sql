-- +goose Up
-- +goose StatementBegin

-- CampusConnect core relational schema (3NF).
-- Deletion policy: historical records (registrations, attendance, certificates,
-- feedback) are restricted; profiles and memberships cascade from users.

CREATE TABLE departments (
    department_id BIGSERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    code          TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT departments_name_unique UNIQUE (name),
    CONSTRAINT departments_code_unique UNIQUE (code),
    CONSTRAINT departments_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT departments_code_format CHECK (code ~ '^[A-Z]{2,8}$')
);

CREATE TABLE users (
    user_id       BIGSERIAL PRIMARY KEY,
    email         TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'student',
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT users_email_unique UNIQUE (email),
    CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
    CONSTRAINT users_email_format CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    CONSTRAINT users_role_check CHECK (role IN ('student', 'coordinator', 'admin')),
    CONSTRAINT users_password_hash_not_blank CHECK (password_hash <> '')
);

CREATE TABLE students (
    student_id        BIGSERIAL PRIMARY KEY,
    user_id           BIGINT NOT NULL,
    department_id     BIGINT NOT NULL,
    full_name         TEXT NOT NULL,
    enrollment_number TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT students_user_unique UNIQUE (user_id),
    CONSTRAINT students_enrollment_unique UNIQUE (enrollment_number),
    CONSTRAINT students_full_name_not_blank CHECK (btrim(full_name) <> ''),
    CONSTRAINT students_enrollment_format CHECK (enrollment_number ~ '^[A-Za-z0-9-]{4,24}$'),
    CONSTRAINT students_user_fk FOREIGN KEY (user_id)
        REFERENCES users (user_id) ON DELETE CASCADE,
    CONSTRAINT students_department_fk FOREIGN KEY (department_id)
        REFERENCES departments (department_id) ON DELETE RESTRICT
);

CREATE TABLE clubs (
    club_id     BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT clubs_name_unique UNIQUE (name),
    CONSTRAINT clubs_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT clubs_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'inactive'))
);

CREATE TABLE club_members (
    membership_id BIGSERIAL PRIMARY KEY,
    student_id    BIGINT NOT NULL,
    club_id       BIGINT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'member',
    status        TEXT NOT NULL DEFAULT 'pending',
    requested_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_at    TIMESTAMPTZ,
    decided_by    BIGINT,
    joined_at     TIMESTAMPTZ,
    CONSTRAINT club_members_student_club_unique UNIQUE (student_id, club_id),
    CONSTRAINT club_members_role_check CHECK (role IN ('member', 'coordinator')),
    CONSTRAINT club_members_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
    CONSTRAINT club_members_decision_check CHECK (
        (status = 'pending' AND decided_at IS NULL AND joined_at IS NULL)
        OR (status = 'approved' AND decided_at IS NOT NULL AND joined_at IS NOT NULL)
        OR (status = 'rejected' AND decided_at IS NOT NULL AND joined_at IS NULL)
    ),
    CONSTRAINT club_members_student_fk FOREIGN KEY (student_id)
        REFERENCES students (student_id) ON DELETE CASCADE,
    CONSTRAINT club_members_club_fk FOREIGN KEY (club_id)
        REFERENCES clubs (club_id) ON DELETE CASCADE,
    CONSTRAINT club_members_decided_by_fk FOREIGN KEY (decided_by)
        REFERENCES users (user_id) ON DELETE SET NULL
);

CREATE TABLE venues (
    venue_id   BIGSERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    capacity   INTEGER NOT NULL,
    location   TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT venues_name_unique UNIQUE (name),
    CONSTRAINT venues_capacity_positive CHECK (capacity > 0),
    CONSTRAINT venues_location_not_blank CHECK (btrim(location) <> '')
);

CREATE TABLE events (
    event_id              BIGSERIAL PRIMARY KEY,
    club_id               BIGINT NOT NULL,
    venue_id              BIGINT NOT NULL,
    created_by            BIGINT,
    title                 TEXT NOT NULL,
    description           TEXT NOT NULL DEFAULT '',
    event_date            TIMESTAMPTZ NOT NULL,
    registration_deadline TIMESTAMPTZ NOT NULL,
    capacity              INTEGER NOT NULL,
    status                TEXT NOT NULL DEFAULT 'pending',
    rejection_reason      TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT events_title_not_blank CHECK (btrim(title) <> ''),
    CONSTRAINT events_capacity_positive CHECK (capacity > 0),
    CONSTRAINT events_deadline_before_event CHECK (registration_deadline <= event_date),
    CONSTRAINT events_status_check CHECK (
        status IN ('draft', 'pending', 'published', 'rejected', 'completed', 'cancelled')
    ),
    CONSTRAINT events_club_fk FOREIGN KEY (club_id)
        REFERENCES clubs (club_id) ON DELETE RESTRICT,
    CONSTRAINT events_venue_fk FOREIGN KEY (venue_id)
        REFERENCES venues (venue_id) ON DELETE RESTRICT,
    CONSTRAINT events_created_by_fk FOREIGN KEY (created_by)
        REFERENCES users (user_id) ON DELETE SET NULL
);

CREATE TABLE registrations (
    registration_id BIGSERIAL PRIMARY KEY,
    student_id      BIGINT NOT NULL,
    event_id        BIGINT NOT NULL,
    registered_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status          TEXT NOT NULL DEFAULT 'confirmed',
    cancelled_at    TIMESTAMPTZ,
    CONSTRAINT registrations_student_event_unique UNIQUE (student_id, event_id),
    CONSTRAINT registrations_status_check CHECK (status IN ('confirmed', 'cancelled', 'waitlisted')),
    CONSTRAINT registrations_cancelled_check CHECK (
        (status = 'cancelled' AND cancelled_at IS NOT NULL)
        OR (status <> 'cancelled' AND cancelled_at IS NULL)
    ),
    CONSTRAINT registrations_student_fk FOREIGN KEY (student_id)
        REFERENCES students (student_id) ON DELETE RESTRICT,
    CONSTRAINT registrations_event_fk FOREIGN KEY (event_id)
        REFERENCES events (event_id) ON DELETE RESTRICT
);

CREATE TABLE attendance (
    attendance_id     BIGSERIAL PRIMARY KEY,
    registration_id   BIGINT NOT NULL,
    attendance_status TEXT NOT NULL DEFAULT 'present',
    marked_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    marked_by         BIGINT,
    CONSTRAINT attendance_registration_unique UNIQUE (registration_id),
    CONSTRAINT attendance_status_check CHECK (attendance_status IN ('present', 'absent')),
    CONSTRAINT attendance_registration_fk FOREIGN KEY (registration_id)
        REFERENCES registrations (registration_id) ON DELETE RESTRICT,
    CONSTRAINT attendance_marked_by_fk FOREIGN KEY (marked_by)
        REFERENCES users (user_id) ON DELETE SET NULL
);

CREATE TABLE feedback (
    feedback_id BIGSERIAL PRIMARY KEY,
    student_id  BIGINT NOT NULL,
    event_id    BIGINT NOT NULL,
    rating      SMALLINT NOT NULL,
    comments    TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT feedback_student_event_unique UNIQUE (student_id, event_id),
    CONSTRAINT feedback_rating_range CHECK (rating BETWEEN 1 AND 5),
    CONSTRAINT feedback_student_fk FOREIGN KEY (student_id)
        REFERENCES students (student_id) ON DELETE RESTRICT,
    CONSTRAINT feedback_event_fk FOREIGN KEY (event_id)
        REFERENCES events (event_id) ON DELETE RESTRICT
);

CREATE TABLE certificates (
    certificate_id   BIGSERIAL PRIMARY KEY,
    registration_id  BIGINT NOT NULL,
    certificate_code TEXT NOT NULL,
    issue_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    CONSTRAINT certificates_registration_unique UNIQUE (registration_id),
    CONSTRAINT certificates_code_unique UNIQUE (certificate_code),
    CONSTRAINT certificates_code_format CHECK (certificate_code ~ '^CC-[0-9]{4}-[0-9]{6,}$'),
    CONSTRAINT certificates_registration_fk FOREIGN KEY (registration_id)
        REFERENCES registrations (registration_id) ON DELETE RESTRICT
);

-- Supporting indexes for list, join and reporting queries.
CREATE INDEX idx_students_department ON students (department_id);
CREATE INDEX idx_students_name ON students (lower(full_name));

CREATE INDEX idx_club_members_club_status ON club_members (club_id, status);
CREATE INDEX idx_club_members_student ON club_members (student_id, status);

CREATE INDEX idx_events_club ON events (club_id);
CREATE INDEX idx_events_venue ON events (venue_id);
CREATE INDEX idx_events_status_date ON events (status, event_date);
CREATE INDEX idx_events_date ON events (event_date) WHERE status = 'published';

CREATE INDEX idx_registrations_event_status ON registrations (event_id, status);
CREATE INDEX idx_registrations_student ON registrations (student_id, registered_at DESC);

CREATE INDEX idx_feedback_event ON feedback (event_id);
CREATE INDEX idx_attendance_status ON attendance (attendance_status);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS certificates;
DROP TABLE IF EXISTS feedback;
DROP TABLE IF EXISTS attendance;
DROP TABLE IF EXISTS registrations;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS venues;
DROP TABLE IF EXISTS club_members;
DROP TABLE IF EXISTS clubs;
DROP TABLE IF EXISTS students;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS departments;
-- +goose StatementEnd
