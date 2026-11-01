# CampusConnect Database Design

**Database:** PostgreSQL 15+ (Neon PostgreSQL)  
**Schema:** `public`  
**Source of truth:** `backend/migrations/00001_schema.sql`,
`00002_functions_triggers.sql`, `00003_views.sql`  
**Seed data:** `backend/seeds/seed.sql`  
**Normal form:** 3NF (see `docs/project-report.md` for the dependency argument).

CampusConnect uses 11 base tables, 5 reporting views, 7 functions and 8 triggers.
There is no ORM: every query is written in SQL and executed through `pgx`.

---

## 1. Conventions

| Convention | Choice |
|---|---|
| Primary keys | `BIGSERIAL` surrogate keys, stable and narrow for foreign keys |
| Timestamps | `TIMESTAMPTZ` (UTC storage), `CURRENT_TIMESTAMP` defaults |
| Calendar dates | `DATE` only for `certificates.issue_date` |
| Text | `TEXT` with `CHECK (btrim(...) <> '')` where blank values are invalid |
| Enumerations | `TEXT` + named `CHECK` constraints (easy to read, no enum migration pain) |
| Referential actions | `ON DELETE RESTRICT` for historical facts, `CASCADE` for dependent profiles/memberships, `SET NULL` for optional "who did it" references |
| Naming | singular table names, `<table>_<column>_<kind>` constraint names |
| Case rules | emails lower-case, enrollment numbers upper-case, department codes upper-case |

---

## 2. Data dictionary

### 2.1 `departments`

Academic departments. Referenced by students.

| Column | Type | Null | Default | Constraints / references | Purpose |
|---|---|---|---|---|---|
| `department_id` | `BIGSERIAL` | No | sequence | PK | Surrogate key |
| `name` | `TEXT` | No | — | `UNIQUE (departments_name_unique)`, non-blank check | Department name |
| `code` | `TEXT` | No | — | `UNIQUE (departments_code_unique)`, `^[A-Z]{2,8}$` | Short code used by forms and seeds |
| `created_at` | `TIMESTAMPTZ` | No | `CURRENT_TIMESTAMP` | — | Audit timestamp |

### 2.2 `users`

Authentication and authorization identity. Deliberately separate from student
profile data so admins and coordinators can exist without a student record.

| Column | Type | Null | Default | Constraints / references | Purpose |
|---|---|---|---|---|---|
| `user_id` | `BIGSERIAL` | No | sequence | PK | Surrogate key |
| `email` | `TEXT` | No | — | `UNIQUE`, must equal `lower(email)`, email regex | Login identifier |
| `password_hash` | `TEXT` | No | — | non-blank | bcrypt cost-12 hash; never plaintext |
| `role` | `TEXT` | No | `'student'` | `IN ('student','coordinator','admin')` | Authorization role |
| `is_active` | `BOOLEAN` | No | `TRUE` | — | Soft enable/disable |
| `created_at` | `TIMESTAMPTZ` | No | `CURRENT_TIMESTAMP` | — | Audit timestamp |
| `updated_at` | `TIMESTAMPTZ` | No | `CURRENT_TIMESTAMP` | trigger `trg_users_set_updated_at` | Last modification |

### 2.3 `students`

Student profile linked one-to-one with a user.

| Column | Type | Null | Default | Constraints / references | Purpose |
|---|---|---|---|---|---|
| `student_id` | `BIGSERIAL` | No | sequence | PK | Surrogate key |
| `user_id` | `BIGINT` | No | — | `UNIQUE`, FK → `users(user_id)` `ON DELETE CASCADE` | Owning account |
| `department_id` | `BIGINT` | No | — | FK → `departments(department_id)` `ON DELETE RESTRICT` | Academic department |
| `full_name` | `TEXT` | No | — | non-blank | Display name |
| `enrollment_number` | `TEXT` | No | — | `UNIQUE`, `^[A-Za-z0-9-]{4,24}$` | Campus identifier |
| `created_at` | `TIMESTAMPTZ` | No | `CURRENT_TIMESTAMP` | — | Audit timestamp |
| `updated_at` | `TIMESTAMPTZ` | No | `CURRENT_TIMESTAMP` | trigger `trg_students_set_updated_at` | Last modification |

### 2.4 `clubs`

Student organizations. Only approved clubs are publicly visible and may host
events.

| Column | Type | Null | Default | Constraints / references | Purpose |
|---|---|---|---|---|---|
| `club_id` | `BIGSERIAL` | No | sequence | PK | Surrogate key |
| `name` | `TEXT` | No | — | `UNIQUE`, non-blank | Club name |
| `description` | `TEXT` | No | `''` | — | Public description |
| `status` | `TEXT` | No | `'pending'` | `IN ('pending','approved','rejected','inactive')` | Approval lifecycle |
| `created_at` | `TIMESTAMPTZ` | No | `CURRENT_TIMESTAMP` | — | Audit timestamp |
| `updated_at` | `TIMESTAMPTZ` | No | `CURRENT_TIMESTAMP` | trigger `trg_clubs_set_updated_at` | Last modification |

### 2.5 `club_members`

Resolves the many-to-many Student–Club relationship and stores the membership
workflow and club-level role.

| Column | Type | Null | Default | Constraints / references | Purpose |
|---|---|---|---|---|---|
| `membership_id` | `BIGSERIAL` | No | sequence | PK | Surrogate key |
| `student_id` | `BIGINT` | No | — | FK → `students(student_id)` `ON DELETE CASCADE` | Member |
| `club_id` | `BIGINT` | No | — | FK → `clubs(club_id)` `ON DELETE CASCADE` | Club |
| `role` | `TEXT` | No | `'member'` | `IN ('member','coordinator')` | Club-level role |
| `status` | `TEXT` | No | `'pending'` | `IN ('pending','approved','rejected')` | Request state |
| `requested_at` | `TIMESTAMPTZ` | No | `CURRENT_TIMESTAMP` | — | Request timestamp |
| `decided_at` | `TIMESTAMPTZ` | Yes | `NULL` | required for approved/rejected by decision check | Decision timestamp |
| `decided_by` | `BIGINT` | Yes | `NULL` | FK → `users(user_id)` `ON DELETE SET NULL` | Deciding coordinator/admin |
| `joined_at` | `TIMESTAMPTZ` | Yes | `NULL` | required for approved, forbidden otherwise | Join timestamp |

**Composite uniqueness:** `UNIQUE (student_id, club_id)` — one membership row per
student/club, even across re-requests.

**Decision check:**

```sql
(status = 'pending'  AND decided_at IS NULL     AND joined_at IS NULL)
OR (status = 'approved' AND decided_at IS NOT NULL AND joined_at IS NOT NULL)
OR (status = 'rejected' AND decided_at IS NOT NULL AND joined_at IS NULL)
```

### 2.6 `venues`

Physical spaces. A venue can host many events over time.

| Column | Type | Null | Default | Constraints / references | Purpose |
|---|---|---|---|---|---|
| `venue_id` | `BIGSERIAL` | No | sequence | PK | Surrogate key |
| `name` | `TEXT` | No | — | `UNIQUE` | Venue name |
| `capacity` | `INTEGER` | No | — | `> 0` | Physical maximum |
| `location` | `TEXT` | No | — | non-blank | Campus location |
| `created_at` | `TIMESTAMPTZ` | No | `CURRENT_TIMESTAMP` | — | Audit timestamp |

### 2.7 `events`

Club events. `capacity` is constrained by the venue through a trigger and by the
registration trigger at registration time.

| Column | Type | Null | Default | Constraints / references | Purpose |
|---|---|---|---|---|---|
| `event_id` | `BIGSERIAL` | No | sequence | PK | Surrogate key |
| `club_id` | `BIGINT` | No | — | FK → `clubs(club_id)` `ON DELETE RESTRICT` | Hosting club |
| `venue_id` | `BIGINT` | No | — | FK → `venues(venue_id)` `ON DELETE RESTRICT` | Hosting venue |
| `created_by` | `BIGINT` | Yes | `NULL` | FK → `users(user_id)` `ON DELETE SET NULL` | Creator account |
| `title` | `TEXT` | No | — | non-blank | Event title |
| `description` | `TEXT` | No | `''` | — | Public description |
| `event_date` | `TIMESTAMPTZ` | No | — | — | Start date/time |
| `registration_deadline` | `TIMESTAMPTZ` | No | — | `<= event_date` | Registration cut-off |
| `capacity` | `INTEGER` | No | — | `> 0`; trigger ≤ venue capacity | Seat limit |
| `status` | `TEXT` | No | `'pending'` | `IN ('draft','pending','published','rejected','completed','cancelled')` | Approval lifecycle |
| `rejection_reason` | `TEXT` | Yes | `NULL` | — | Admin rejection note |
| `created_at` | `TIMESTAMPTZ` | No | `CURRENT_TIMESTAMP` | — | Audit timestamp |
| `updated_at` | `TIMESTAMPTZ` | No | `CURRENT_TIMESTAMP` | trigger `trg_events_set_updated_at` | Last modification |

### 2.8 `registrations`

Resolves the many-to-many Student–Event relationship and records cancellations
without deleting history.

| Column | Type | Null | Default | Constraints / references | Purpose |
|---|---|---|---|---|---|
| `registration_id` | `BIGSERIAL` | No | sequence | PK | Surrogate key |
| `student_id` | `BIGINT` | No | — | FK → `students(student_id)` `ON DELETE RESTRICT` | Registrant |
| `event_id` | `BIGINT` | No | — | FK → `events(event_id)` `ON DELETE RESTRICT` | Event |
| `registered_at` | `TIMESTAMPTZ` | No | `CURRENT_TIMESTAMP` | — | Registration time |
| `status` | `TEXT` | No | `'confirmed'` | `IN ('confirmed','cancelled','waitlisted')` | Registration state |
| `cancelled_at` | `TIMESTAMPTZ` | Yes | `NULL` | required iff status = cancelled | Cancellation time |

**Composite uniqueness:** `UNIQUE (student_id, event_id)` — one row per pair.

**State check:**

```sql
(status = 'cancelled' AND cancelled_at IS NOT NULL)
OR (status <> 'cancelled' AND cancelled_at IS NULL)
```

### 2.9 `attendance`

At most one attendance record per registration.

| Column | Type | Null | Default | Constraints / references | Purpose |
|---|---|---|---|---|---|
| `attendance_id` | `BIGSERIAL` | No | sequence | PK | Surrogate key |
| `registration_id` | `BIGINT` | No | — | `UNIQUE`, FK → `registrations(registration_id)` `ON DELETE RESTRICT` | Attended registration |
| `attendance_status` | `TEXT` | No | `'present'` | `IN ('present','absent')` | Attendance mark |
| `marked_at` | `TIMESTAMPTZ` | No | `CURRENT_TIMESTAMP` | — | Mark time |
| `marked_by` | `BIGINT` | Yes | `NULL` | FK → `users(user_id)` `ON DELETE SET NULL` | Marker account |

### 2.10 `feedback`

One feedback row per student/event.

| Column | Type | Null | Default | Constraints / references | Purpose |
|---|---|---|---|---|---|
| `feedback_id` | `BIGSERIAL` | No | sequence | PK | Surrogate key |
| `student_id` | `BIGINT` | No | — | FK → `students(student_id)` `ON DELETE RESTRICT` | Author |
| `event_id` | `BIGINT` | No | — | FK → `events(event_id)` `ON DELETE RESTRICT` | Reviewed event |
| `rating` | `SMALLINT` | No | — | `BETWEEN 1 AND 5` | Star rating |
| `comments` | `TEXT` | No | `''` | — | Free-text comment (API caps 1000 chars) |
| `created_at` | `TIMESTAMPTZ` | No | `CURRENT_TIMESTAMP` | — | Submission time |

**Composite uniqueness:** `UNIQUE (student_id, event_id)`.

### 2.11 `certificates`

At most one certificate per registration; codes are globally unique.

| Column | Type | Null | Default | Constraints / references | Purpose |
|---|---|---|---|---|---|
| `certificate_id` | `BIGSERIAL` | No | sequence | PK | Surrogate key |
| `registration_id` | `BIGINT` | No | — | `UNIQUE`, FK → `registrations(registration_id)` `ON DELETE RESTRICT` | Earning registration |
| `certificate_code` | `TEXT` | No | — | `UNIQUE`, `^CC-[0-9]{4}-[0-9]{6,}$` | Human-readable code |
| `issue_date` | `DATE` | No | `CURRENT_DATE` | — | Issue date |

---

## 3. Keys and uniqueness summary

| Table | Primary key | Unique / candidate keys | Foreign keys |
|---|---|---|---|
| `departments` | `department_id` | `name`, `code` | — |
| `users` | `user_id` | `email` | — |
| `students` | `student_id` | `user_id`, `enrollment_number` | `user_id` → users, `department_id` → departments |
| `clubs` | `club_id` | `name` | — |
| `club_members` | `membership_id` | `(student_id, club_id)` | `student_id` → students, `club_id` → clubs, `decided_by` → users |
| `venues` | `venue_id` | `name` | — |
| `events` | `event_id` | — | `club_id` → clubs, `venue_id` → venues, `created_by` → users |
| `registrations` | `registration_id` | `(student_id, event_id)` | `student_id` → students, `event_id` → events |
| `attendance` | `attendance_id` | `registration_id` | `registration_id` → registrations, `marked_by` → users |
| `feedback` | `feedback_id` | `(student_id, event_id)` | `student_id` → students, `event_id` → events |
| `certificates` | `certificate_id` | `registration_id`, `certificate_code` | `registration_id` → registrations |

No composite primary keys are used; the two many-to-many junctions keep surrogate
primary keys plus composite `UNIQUE` constraints. This keeps foreign keys simple
while still enforcing the business identity of each row.

---

## 4. Referential actions

| Child → Parent | Action | Reason |
|---|---|---|
| `students.user_id` → `users` | `CASCADE` | A profile has no meaning without its account |
| `students.department_id` → `departments` | `RESTRICT` | Cannot orphan students |
| `club_members.student_id` → `students` | `CASCADE` | Memberships belong to the profile |
| `club_members.club_id` → `clubs` | `CASCADE` | Deleting a club removes its roster |
| `club_members.decided_by` → `users` | `SET NULL` | Keep the membership if the decider leaves |
| `events.club_id` → `clubs` | `RESTRICT` | Event history must not disappear |
| `events.venue_id` → `venues` | `RESTRICT` | Venue history must not disappear |
| `events.created_by` → `users` | `SET NULL` | Keep the event if the creator leaves |
| `registrations.student_id` → `students` | `RESTRICT` | Historical registrations are preserved |
| `registrations.event_id` → `events` | `RESTRICT` | Historical registrations are preserved |
| `attendance.registration_id` → `registrations` | `RESTRICT` | Attendance is a historical fact |
| `attendance.marked_by` → `users` | `SET NULL` | Keep the mark if the marker leaves |
| `feedback.student_id` → `students` | `RESTRICT` | Feedback is preserved for reporting |
| `feedback.event_id` → `events` | `RESTRICT` | Feedback is preserved for reporting |
| `certificates.registration_id` → `registrations` | `RESTRICT` | Certificates are permanent evidence |

Because `registrations.student_id` is `RESTRICT`, deleting a user cascades to the
student row but is blocked if that student has registrations. The API therefore
uses soft deactivation (`users.is_active`) instead of deleting active accounts.

---

## 5. Index inventory

Primary keys and unique constraints create implicit unique indexes. The
migrations add these explicit indexes:

| Index | Table | Definition | Supports |
|---|---|---|---|
| `idx_students_department` | `students` | `(department_id)` | Department roster and joins |
| `idx_students_name` | `students` | `(lower(full_name))` | Case-insensitive name search |
| `idx_club_members_club_status` | `club_members` | `(club_id, status)` | Pending/approved member lists |
| `idx_club_members_student` | `club_members` | `(student_id, status)` | "My clubs" and coordinator checks |
| `idx_events_club` | `events` | `(club_id)` | Club event lists |
| `idx_events_venue` | `events` | `(venue_id)` | Venue event counts and deletion checks |
| `idx_events_status_date` | `events` | `(status, event_date)` | Admin/coordinator status + date lists |
| `idx_events_date` | `events` | `(event_date) WHERE status = 'published'` | Public upcoming-event lookup (partial index) |
| `idx_registrations_event_status` | `registrations` | `(event_id, status)` | Capacity count and event roster |
| `idx_registrations_student` | `registrations` | `(student_id, registered_at DESC)` | Student registration history |
| `idx_feedback_event` | `feedback` | `(event_id)` | Event feedback and averages |
| `idx_attendance_status` | `attendance` | `(attendance_status)` | Attendance reporting |

The partial index `idx_events_date` is smaller than a full index and matches the
public query predicate exactly (`status = 'published'`). Composite indexes place
the equality column first, then the range/sort column.

---

## 6. View inventory

| View | Grain | Purpose |
|---|---|---|
| `upcoming_events` | One row per published future event | Public event cards with live confirmed count and seats remaining; joins club, venue and registrations |
| `event_registration_summary` | One row per event | Registration, attendance and feedback roll-up for coordinator/admin reporting |
| `club_membership_summary` | One row per club | Approved members, pending requests, total requests and coordinator count |
| `student_registration_history` | One row per registration | Flattened student history with attendance (`not_marked`) and certificate |
| `platform_stats` | Single row | Admin snapshot: users, students, clubs, events, confirmed registrations, certificates, average rating |

All views are read-only projections; none is materialized, so results are always
current.

---

## 7. Function inventory

| Function | Returns | Language | Purpose |
|---|---|---|---|
| `fn_set_updated_at()` | `TRIGGER` | PL/pgSQL | Sets `NEW.updated_at = CURRENT_TIMESTAMP` |
| `fn_validate_event_venue_capacity()` | `TRIGGER` | PL/pgSQL | Rejects event capacity above venue capacity (SQLSTATE 23514) |
| `fn_enforce_event_capacity()` | `TRIGGER` | PL/pgSQL | Locks the event row and rejects confirmed registrations beyond capacity |
| `fn_validate_attendance_registration()` | `TRIGGER` | PL/pgSQL | Rejects attendance unless the registration is confirmed |
| `fn_issue_certificate_for_attendance()` | `TRIGGER` | PL/pgSQL | Issues a certificate when attendance is `present` (idempotent) |
| `fn_award_certificate(bigint)` | `TABLE(certificate_id, certificate_code, issue_date)` | PL/pgSQL | Coordinator/backfill issuance; validates present attendance and is idempotent |
| `fn_event_stats(bigint)` | `TABLE(event stats)` | SQL (STABLE) | Per-event registration, attendance and feedback aggregates |

`fn_event_stats` and `fn_award_certificate` are the two application-callable
functions; the others are trigger functions.

---

## 8. Trigger inventory

| Trigger | Table / event | Timing | Effect |
|---|---|---|---|
| `trg_users_set_updated_at` | `users` `UPDATE` | BEFORE, row | Refresh `updated_at` |
| `trg_students_set_updated_at` | `students` `UPDATE` | BEFORE, row | Refresh `updated_at` |
| `trg_clubs_set_updated_at` | `clubs` `UPDATE` | BEFORE, row | Refresh `updated_at` |
| `trg_events_set_updated_at` | `events` `UPDATE` | BEFORE, row | Refresh `updated_at` |
| `trg_events_validate_venue_capacity` | `events` `INSERT` or `UPDATE OF capacity, venue_id` | BEFORE, row | Enforce `capacity <= venue.capacity` |
| `trg_registrations_enforce_capacity` | `registrations` `INSERT` or `UPDATE OF status, event_id` | BEFORE, row | Lock event; reject over-capacity confirmed rows |
| `trg_attendance_validate_registration` | `attendance` `INSERT` or `UPDATE OF registration_id` | BEFORE, row | Require confirmed registration |
| `trg_attendance_issue_certificate` | `attendance` `INSERT` or `UPDATE OF attendance_status` | AFTER, row | Insert certificate for `present`, `ON CONFLICT DO NOTHING` |

---

## 9. Seed data

`backend/seeds/seed.sql` truncates and reloads all tables inside one transaction.
Dates are relative to `CURRENT_DATE`, so upcoming/completed states remain valid
whenever the seed is run.

| Entity | Rows | Composition |
|---|---:|---|
| `departments` | 5 | CSE, ECE, MECH, BBA, DSGN |
| `users` | 32 | 1 admin, 7 coordinators, 24 students |
| `students` | 31 | 7 coordinator profiles + 24 student profiles |
| `clubs` | 8 | 7 approved + 1 pending (Debate Society) |
| `venues` | 8 | Capacities 40–500 |
| `club_members` | ~82 | 7 approved coordinators, 61 approved members, 14 pending requests |
| `events` | 14 | 5 completed, 7 published, 2 pending |
| `registrations` | 153 | 150 confirmed across 12 events + 3 cancelled |
| `attendance` | 77 | All confirmed registrations of the 5 completed events |
| `certificates` | 67 | Issued automatically for present attendance |
| `feedback` | 36 | From present attendees with even student ids |

Exact membership/attendance/feedback counts depend only on the deterministic
seed expressions; the verification block at the end of `seed.sql` prints the
authoritative counts for any database.

### 9.1 Demo credentials

All hashes are bcrypt cost 12 and correspond to the documented passwords. No
plaintext password is stored in the database.

| Role | Email | Password |
|---|---|---|
| Admin | `admin@campusconnect.test` | `Admin123!` |
| Coordinator | `priya@campusconnect.test` (Coding Club) | `Coordinator123!` |
| Coordinator | `arjun@campusconnect.test` (Robotics Club) | `Coordinator123!` |
| Coordinator | `sana@campusconnect.test` (Entrepreneurship Cell) | `Coordinator123!` |
| Coordinator | `rohan@campusconnect.test` (Design Collective) | `Coordinator123!` |
| Coordinator | `meera@campusconnect.test` (Sports Club) | `Coordinator123!` |
| Coordinator | `kabir@campusconnect.test` (Campus Life Society) | `Coordinator123!` |
| Coordinator | `ananya@campusconnect.test` (Music Club) | `Coordinator123!` |
| Students | `student01@campusconnect.test` … `student24@campusconnect.test` | `Password123!` |

The admin and coordinator hashes in the seed file are distinct bcrypt strings;
the 24 students share one hash. All were generated at cost 12, so login works
only with the passwords above.

---

## 10. Maintenance notes

1. Apply migrations with Goose (embedded in the backend). Never edit an applied
   migration; add a new numbered file.
2. Run `seeds/seed.sql` only against a development database: it truncates every
   table.
3. `TRUNCATE ... RESTART IDENTITY CASCADE` in the seed is safe because it runs in
   a transaction and is followed immediately by deterministic inserts.
4. Keep `idx_events_date` partial (`status = 'published'`) if the public listing
   continues to filter on that status; a general date index would be larger.
5. Revisit `ON DELETE RESTRICT` only with an archival strategy; today the API
   soft-deletes accounts and cancels registrations rather than deleting history.
