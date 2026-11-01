# CampusConnect — Project Report

**A college club and event management platform demonstrating relational database design and full-stack engineering**

---

## 1. Abstract

CampusConnect is a full-stack web application for managing college clubs, membership
requests, events, registrations, attendance, feedback and certificates. Students
discover approved clubs and published events, request membership, register within
capacity, cancel registrations, submit post-event feedback and collect
certificates. Club coordinators review membership requests, manage their clubs'
events, mark attendance and read event statistics. Administrators manage users,
students, departments, clubs, venues, event approvals and platform-wide reporting.

The system uses a three-tier architecture: a Vite + React + TypeScript client, a
Go + Chi + pgx REST API, and a Neon PostgreSQL database. The database is the
centre of the project rather than an afterthought. It contains 11 normalised
tables, 12 explicit indexes, 5 reporting views, 7 functions and 8 triggers, and it
enforces integrity rules that the application cannot bypass. A 55-query
demonstration script exercises joins, aggregates, subqueries, CTEs, window
functions, views, indexes, DML, constraints, row locks, triggers, stored functions
and privileges. The registration path uses `SELECT ... FOR UPDATE` plus a
database trigger so that concurrent requests cannot overbook an event.

**Keywords:** relational database, PostgreSQL, 3NF, club management, event
registration, row-level locking, triggers, REST API, React.

---

## 2. Problem statement

College club activity is usually coordinated through a mixture of spreadsheets,
chat groups and paper sign-up sheets. This creates predictable failures:

- students cannot see which clubs are approved or which events are open;
- membership requests are lost or decided inconsistently;
- event seats are overbooked because two coordinators count registrations at the
  same time;
- duplicate registrations are common and cancellations are not tracked;
- attendance and certificate records are reconstructed after the event;
- there is no reliable platform-level reporting for administrators;
- access control is informal, so any coordinator can edit any club's data.

A database-backed platform can remove these failures by giving every fact a single
home and every rule a single enforcement point. CampusConnect addresses the
problem with a normalised relational schema, explicit constraints, transactional
workflows and role-aware APIs.

---

## 3. Objectives

1. Provide one place for students to discover clubs and events and to manage their
   memberships, registrations and certificates.
2. Give coordinators scoped tools for membership decisions, event management,
   attendance and event analytics.
3. Give administrators platform-wide management and reporting.
4. Enforce data integrity in PostgreSQL through primary keys, foreign keys,
   `UNIQUE`, `CHECK` and `NOT NULL` constraints.
5. Make event registration concurrency-safe so capacity is never exceeded.
6. Demonstrate the RDBMS syllabus on a real application: joins, aggregation,
   subqueries, CTEs, window functions, views, indexes, transactions, triggers and
   stored functions.
7. Deliver a clean, documented REST API and a responsive role-based frontend.

---

## 4. Scope

**In scope**

- Account registration, login, logout, profile update and password change.
- Student, coordinator and administrator roles with backend-enforced permissions.
- Department, venue, club, student and user administration.
- Club membership requests, approvals, rejections, role changes and removal.
- Event creation, editing, deletion, approval workflow and public discovery.
- Capacity-safe registration, cancellation and registration history.
- Attendance marking for confirmed registrations.
- Automatic certificate issuance for present attendance.
- Post-event feedback with rating and comments.
- Student, coordinator and admin dashboards.
- SQL demonstration, API documentation, ER diagram and this report.

**Out of scope**

- Online payments or ticketing.
- Email/SMS notifications and calendar invites.
- Server-side PDF certificate generation (the client prints/exports).
- Native mobile applications.
- Multi-tenant or multi-campus isolation.
- Automated waitlist promotion (the `waitlisted` status exists but is not
  currently produced by the API).

---

## 5. Technology stack

| Layer | Technology | Role |
|---|---|---|
| Frontend | Vite 8, React 19, TypeScript 7 | SPA build and typing |
| Styling | Tailwind CSS 4 | Design system and responsive layout |
| Routing | React Router 7 | Public, student, coordinator and admin routes |
| Server state | TanStack Query 5 | Fetching, caching and invalidation |
| Forms | React Hook Form 7 + Zod 4 | Client validation and field errors |
| Charts | Recharts 3 | Admin and coordinator dashboards |
| Backend | Go, Chi v5 | HTTP routing, middleware and handlers |
| Database driver | pgx/v5 + pgxpool | Parameterised SQL and pooling |
| Auth | golang-jwt/jwt v5, bcrypt cost 12 | Session JWT and password hashing |
| Validation | go-playground/validator | Request DTO validation |
| Migrations | Goose (embedded SQL) | Versioned schema source of truth |
| Database | Neon PostgreSQL 15+ | Relational storage and server-side logic |
| Tooling | Postman, ERDPlus, Git, Vitest/RTL, Go testing | Testing and documentation |

No ORM is used. Every repository method is hand-written SQL with `$1, $2, ...`
placeholders, which keeps the relational work visible and avoids hidden queries.

---

## 6. System architecture

CampusConnect follows a three-tier architecture.

```text
┌────────────────────────────────────────────────────────────┐
│ Tier 1 — Presentation                                      │
│ Vite + React + TypeScript SPA                              │
│ Public pages · Student · Coordinator · Admin dashboards    │
└───────────────────────────┬────────────────────────────────┘
                            │ HTTPS / JSON, /api/v1
                            ▼
┌────────────────────────────────────────────────────────────┐
│ Tier 2 — Application                                       │
│ Chi router → middleware (request ID, log, recover, CORS,    │
│ auth, CSRF, RBAC) → handlers → services → repositories     │
│ pgxpool connection pool                                     │
└───────────────────────────┬────────────────────────────────┘
                            │ SQL (parameterised)
                            ▼
┌────────────────────────────────────────────────────────────┐
│ Tier 3 — Data                                              │
│ Neon PostgreSQL: 11 tables · constraints · indexes · views  │
│ transactions · triggers · functions                         │
└────────────────────────────────────────────────────────────┘
```

**Layer responsibilities**

| Layer | Responsibility | Must not do |
|---|---|---|
| Handlers | Decode/validate HTTP, call services, write envelopes | SQL or business rules |
| Services | Authorization and business rules, orchestration | SQL or HTTP types |
| Repositories | Parameterised SQL, transactions, row mapping | HTTP or authorization decisions |
| Models | Shared camelCase DTOs | Persistence logic |
| Middleware | Session parsing, role checks, CSRF, CORS, logging, recovery | Feature rules |

**Example request flow — event registration**

1. Student clicks **Register** in the React event page.
2. The API service sends `POST /api/v1/events/{id}/register` with the session
   cookie and `X-CSRF-Token`.
3. Auth middleware validates the JWT and reloads the user, role and student id
   from PostgreSQL. CSRF middleware compares cookie and header.
4. The handler parses the event id; the service requires a student profile.
5. `RegistrationRepository.Register` begins a transaction, locks the event row,
   validates status/deadline/start time, counts confirmed registrations, checks
   capacity, inserts or reactivates the registration and commits.
6. The handler returns `201` with the registration; TanStack Query invalidates
   the event and "my registrations" queries.

Keeping these layers separate makes the business rules testable and prevents SQL
from leaking into HTTP code.

---

## 7. ER model and relational mapping

The conceptual model has nine strong entities — **Users, Departments, Students,
Clubs, Venues, Events, Attendance, Feedback, Certificates** — plus two associative
entities, **Club_Members** and **Registrations**. The associative entities are
promoted to tables because they carry their own attributes and because
`Attendance` and `Certificates` reference a registration, which a pure M:N diamond
cannot support.

| Relationship | Cardinality | Relational implementation |
|---|---|---|
| Department — Student | 1:N | `students.department_id` |
| User — Student | 1:0..1 | `students.user_id UNIQUE` |
| Student — Club (membership) | M:N | `club_members`, `UNIQUE(student_id, club_id)` |
| Club — ClubMember | 1:N | `club_members.club_id` |
| Club — Event | 1:N | `events.club_id` |
| Venue — Event | 1:N | `events.venue_id` |
| Student — Event (registration) | M:N | `registrations`, `UNIQUE(student_id, event_id)` |
| Event — Registration | 1:N | `registrations.event_id` |
| Registration — Attendance | 1:0..1 | `attendance.registration_id UNIQUE` |
| Registration — Certificate | 1:0..1 | `certificates.registration_id UNIQUE` |
| Student — Feedback | 1:N | `feedback.student_id` |
| Event — Feedback | 1:N | `feedback.event_id` |
| User — Event (creator) | 1:0..N | `events.created_by`, nullable |
| User — ClubMember (decider) | 1:0..N | `club_members.decided_by`, nullable |
| User — Attendance (marker) | 1:0..N | `attendance.marked_by`, nullable |

Mapping rules applied:

- strong entity → table with a surrogate primary key;
- 1:1 → foreign key on the optional side plus `UNIQUE`;
- 1:N → foreign key on the many side;
- M:N → junction table with two foreign keys and a composite `UNIQUE`;
- optional participation → nullable foreign key;
- derived values (seat counts, averages) → views/functions, never stored columns.

The full diagram and ERDPlus/Chen instructions are in `docs/er-diagram.md`.

---

## 8. Functional dependencies and normalisation

Notation: `X → Y` means X functionally determines Y. Candidate keys are shown in
bold.

### 8.1 Functional dependencies

| Relation | Functional dependencies | Candidate keys |
|---|---|---|
| `departments` | `department_id → name, code, created_at`; `name → department_id`; `code → department_id` | **department_id**, name, code |
| `users` | `user_id → email, password_hash, role, is_active, created_at, updated_at`; `email → user_id` | **user_id**, email |
| `students` | `student_id → user_id, department_id, full_name, enrollment_number, created_at, updated_at`; `user_id → student_id`; `enrollment_number → student_id` | **student_id**, user_id, enrollment_number |
| `clubs` | `club_id → name, description, status, created_at, updated_at`; `name → club_id` | **club_id**, name |
| `club_members` | `membership_id → student_id, club_id, role, status, requested_at, decided_at, decided_by, joined_at`; `(student_id, club_id) → membership_id, role, status, requested_at, decided_at, decided_by, joined_at` | **membership_id**, (student_id, club_id) |
| `venues` | `venue_id → name, capacity, location, created_at`; `name → venue_id` | **venue_id**, name |
| `events` | `event_id → club_id, venue_id, created_by, title, description, event_date, registration_deadline, capacity, status, rejection_reason, created_at, updated_at` | **event_id** |
| `registrations` | `registration_id → student_id, event_id, registered_at, status, cancelled_at`; `(student_id, event_id) → registration_id, registered_at, status, cancelled_at` | **registration_id**, (student_id, event_id) |
| `attendance` | `attendance_id → registration_id, attendance_status, marked_at, marked_by`; `registration_id → attendance_id, attendance_status, marked_at, marked_by` | **attendance_id**, registration_id |
| `feedback` | `feedback_id → student_id, event_id, rating, comments, created_at`; `(student_id, event_id) → feedback_id, rating, comments, created_at` | **feedback_id**, (student_id, event_id) |
| `certificates` | `certificate_id → registration_id, certificate_code, issue_date`; `registration_id → certificate_id, certificate_code, issue_date`; `certificate_code → certificate_id` | **certificate_id**, registration_id, certificate_code |

### 8.2 First normal form (1NF)

Every column stores a single atomic value. There are no repeating groups, arrays
or comma-separated lists: a student's several clubs live in several
`club_members` rows, not in a `clubs` column; an event's several registrations
live in `registrations`. Every relation has a primary key, so duplicate rows are
impossible. `TEXT` is used for free text, but values such as `role` and `status`
are constrained to a fixed vocabulary by `CHECK` constraints.

### 8.3 Second normal form (2NF)

2NF requires every non-key attribute to depend on the whole candidate key, not
part of it.

- Tables with a single-column primary key (`users`, `departments`, `students`,
  `clubs`, `venues`, `events`, `attendance`, `feedback`, `certificates`) cannot
  have a partial dependency on a one-column key.
- `club_members` has a composite candidate key `(student_id, club_id)`. Its
  attributes describe the pair: `role` is the student's role *in that club*,
  `status` is that request's state, and the timestamps record that request. None
  depends on `student_id` alone or `club_id` alone.
- `registrations` has composite candidate key `(student_id, event_id)`. `status`,
  `registered_at` and `cancelled_at` describe that student's registration for
  that event, not the student or the event in isolation.

The surrogate keys (`membership_id`, `registration_id`) are introduced for
foreign-key stability; the composite unique constraints remain the business keys,
so the 2NF argument holds.

### 8.4 Third normal form (3NF)

3NF requires no transitive dependency: every non-key attribute depends on the key
and nothing but the key.

- Department name and code exist only in `departments`, not in every student row.
- Venue name, capacity and location exist only in `venues`, not in `events`.
- Club name and description exist only in `clubs`, not in `events` or
  `club_members`.
- Student name, email and enrollment number are not repeated in
  `registrations`; they are reached through `students`/`users`.
- Event title and date are not repeated in `registrations`, `attendance` or
  `certificates`.
- `events.capacity` is *not* a copy of `venues.capacity`. It is an independent
  business decision (a club may sell fewer seats than the room holds), and the
  trigger only enforces `event.capacity <= venue.capacity`. It therefore depends
  on the event, not transitively on the venue.
- `certificates.certificate_code` is a human-readable business identifier
  determined by the registration and issue year. It is a candidate key in its own
  right and is stored once in `certificates`, not duplicated elsewhere.
- Derived values such as `seats_remaining`, `confirmed_registrations`,
  `average_rating` and `present_count` are computed by views/functions rather
  than stored, so they cannot drift.

**Deliberate design choices.** Authentication (`users`) is separate from student
profile data (`students`) so admins and coordinators can exist without student
records; `users.role` is the platform role, while `club_members.role` is the
club-scoped role. Statuses are `TEXT + CHECK` rather than PostgreSQL enums, which
keeps migrations simple and the allowed values visible in the schema. The
`waitlisted` registration status is reserved for future waitlist automation.

---

## 9. Table-by-table data dictionary

Full column-level details are in `docs/database-design.md`; this table summarises
each relation.

| # | Table | Purpose | Key columns | Main constraints |
|---:|---|---|---|---|
| 1 | `departments` | Academic departments | `department_id` PK; `name`, `code` | unique name/code; code `^[A-Z]{2,8}$` |
| 2 | `users` | Login identity and platform role | `user_id` PK; `email`, `password_hash`, `role`, `is_active` | unique lower-case email; role check; bcrypt hash non-blank |
| 3 | `students` | Student profile | `student_id` PK; `user_id`, `department_id`, `full_name`, `enrollment_number` | unique user/enrollment; user cascade; department restrict |
| 4 | `clubs` | Student organisations | `club_id` PK; `name`, `description`, `status` | unique name; status in pending/approved/rejected/inactive |
| 5 | `club_members` | Membership requests and club roles | `membership_id` PK; `student_id`, `club_id`, `role`, `status`, decision timestamps | unique `(student_id, club_id)`; decision consistency check |
| 6 | `venues` | Physical event spaces | `venue_id` PK; `name`, `capacity`, `location` | unique name; capacity > 0 |
| 7 | `events` | Club events | `event_id` PK; `club_id`, `venue_id`, `title`, dates, capacity, status | deadline ≤ event date; capacity > 0; status check |
| 8 | `registrations` | Student–event registrations | `registration_id` PK; `student_id`, `event_id`, `status`, `cancelled_at` | unique pair; cancellation consistency check |
| 9 | `attendance` | One mark per registration | `attendance_id` PK; `registration_id`, `attendance_status`, `marked_at`, `marked_by` | unique registration; status present/absent |
| 10 | `feedback` | Post-event rating and comments | `feedback_id` PK; `student_id`, `event_id`, `rating`, `comments` | unique pair; rating 1–5 |
| 11 | `certificates` | Issued certificates | `certificate_id` PK; `registration_id`, `certificate_code`, `issue_date` | unique registration; unique code; code format |

---

## 10. Constraints and `ON DELETE` policy

**Constraint families used**

- **PRIMARY KEY** on every table (surrogate `BIGSERIAL`).
- **FOREIGN KEY** on all 14 relationship columns, with deliberate actions.
- **UNIQUE** on emails, names, codes, enrollment numbers and the business keys
  `(student_id, club_id)`, `(student_id, event_id)`, `attendance.registration_id`,
  `certificates.registration_id` and `certificates.certificate_code`.
- **CHECK** for roles, statuses, positive capacities, rating range, email format,
  lower-case email, enrollment format, department code format, certificate code
  format, non-blank text and timestamp consistency.
- **NOT NULL** on every mandatory attribute.

Examples:

```sql
CONSTRAINT feedback_rating_range CHECK (rating BETWEEN 1 AND 5)
CONSTRAINT events_deadline_before_event CHECK (registration_deadline <= event_date)
CONSTRAINT registrations_cancelled_check CHECK (
    (status = 'cancelled' AND cancelled_at IS NOT NULL)
    OR (status <> 'cancelled' AND cancelled_at IS NULL)
)
CONSTRAINT club_members_decision_check CHECK (
    (status = 'pending'  AND decided_at IS NULL AND joined_at IS NULL)
    OR (status = 'approved' AND decided_at IS NOT NULL AND joined_at IS NOT NULL)
    OR (status = 'rejected' AND decided_at IS NOT NULL AND joined_at IS NULL)
)
```

**Deletion policy**

| Delete | Action | Rationale |
|---|---|---|
| User → student profile | `CASCADE` | Profile is meaningless without its account |
| Student → memberships | `CASCADE` | Membership belongs to the profile |
| Club → memberships | `CASCADE` | Roster belongs to the club |
| Department → students | `RESTRICT` | Never orphan students |
| Club → events | `RESTRICT` | Preserve event history |
| Venue → events | `RESTRICT` | Preserve event history |
| Student → registrations | `RESTRICT` | Registration is a historical fact |
| Event → registrations | `RESTRICT` | Registration is a historical fact |
| Registration → attendance | `RESTRICT` | Attendance is evidence |
| Registration → certificates | `RESTRICT` | Certificate is permanent evidence |
| Student/event → feedback | `RESTRICT` | Preserve reporting history |
| `decided_by`/`created_by`/`marked_by` → user | `SET NULL` | Keep the record if the actor leaves |

The API rarely hard-deletes: accounts are deactivated with `is_active`, and
registrations are cancelled with a status change. The `RESTRICT` rules are the
last line of defence if a future endpoint attempts a destructive delete.
`docs/sql-queries.sql` Q38–Q43 demonstrate the actions and expected SQLSTATEs.

---

## 11. Indexes

Primary keys and unique constraints create implicit unique indexes. Twelve
explicit indexes target the real query patterns:

| Index | Definition | Query supported |
|---|---|---|
| `idx_students_department` | `(department_id)` | Department roster, joins |
| `idx_students_name` | `(lower(full_name))` | Case-insensitive student search |
| `idx_club_members_club_status` | `(club_id, status)` | Pending/approved member lists |
| `idx_club_members_student` | `(student_id, status)` | "My clubs", coordinator checks |
| `idx_events_club` | `(club_id)` | Club event lists |
| `idx_events_venue` | `(venue_id)` | Venue counts and delete checks |
| `idx_events_status_date` | `(status, event_date)` | Status + date lists |
| `idx_events_date` | `(event_date) WHERE status = 'published'` | Public upcoming events (partial) |
| `idx_registrations_event_status` | `(event_id, status)` | Capacity count, event roster |
| `idx_registrations_student` | `(student_id, registered_at DESC)` | Student history |
| `idx_feedback_event` | `(event_id)` | Feedback and rating averages |
| `idx_attendance_status` | `(attendance_status)` | Attendance reporting |

The partial index on published events is smaller and exactly matches the public
list predicate. Composite indexes put equality columns first (`event_id, status`)
so the capacity `COUNT(*)` can use an index-only path. `docs/sql-queries.sql`
Q26–Q29 use `EXPLAIN (ANALYZE, BUFFERS)`; on a small seeded database the planner
may still choose a sequential scan, so the demonstration temporarily disables
`enable_seqscan` to show the intended access path and explains the caveat.

---

## 12. Views

| View | Output | Consumer |
|---|---|---|
| `upcoming_events` | Published future events with confirmed count and `seats_remaining` | Public event cards, student dashboard |
| `event_registration_summary` | Registrations, present count, feedback count, average rating per event | Coordinator/admin reporting |
| `club_membership_summary` | Approved members, pending requests, total requests, coordinator count | Club directory/admin |
| `student_registration_history` | Student, event, club, registration status, attendance (`not_marked`) and certificate | Student history |
| `platform_stats` | Single-row totals for users, students, clubs, events, registrations, certificates and average rating | Admin dashboard |

Views keep reporting SQL out of the handlers while preserving a single definition
of each metric. They are regular (not materialised) views, so they always reflect
committed data.

---

## 13. Triggers and functions

**Triggers (8)**

| Trigger | Purpose |
|---|---|
| `trg_users_set_updated_at`, `trg_students_set_updated_at`, `trg_clubs_set_updated_at`, `trg_events_set_updated_at` | Refresh `updated_at` on every update |
| `trg_events_validate_venue_capacity` | Reject event capacity above venue capacity |
| `trg_registrations_enforce_capacity` | Lock the event row and reject confirmed registrations beyond capacity |
| `trg_attendance_validate_registration` | Attendance only for confirmed registrations |
| `trg_attendance_issue_certificate` | Issue a certificate when attendance becomes `present` |

**Functions (7)**

| Function | Purpose |
|---|---|
| `fn_set_updated_at()` | Trigger helper for timestamps |
| `fn_validate_event_venue_capacity()` | Venue-capacity trigger helper |
| `fn_enforce_event_capacity()` | Registration-capacity trigger helper |
| `fn_validate_attendance_registration()` | Attendance precondition helper |
| `fn_issue_certificate_for_attendance()` | Idempotent certificate insert |
| `fn_award_certificate(bigint)` | Coordinator/backfill issuance; returns existing row on retry |
| `fn_event_stats(bigint)` | Per-event registration, attendance and feedback statistics |

The triggers provide defence in depth. Application validation produces friendly
messages, but direct SQL, a future script or a race that bypasses a service still
cannot violate capacity, venue size, attendance preconditions or certificate
uniqueness.

---

## 14. Transactions and concurrency

### 14.1 Registration transaction

The repository implements the required sequence:

```text
BEGIN
  SELECT status, capacity,
         registration_deadline >= CURRENT_TIMESTAMP,
         event_date > CURRENT_TIMESTAMP
  FROM events WHERE event_id = $1
  FOR UPDATE;                         -- serialises competing registrations
  IF status <> 'published' OR deadline passed OR started -> rollback, 409
  SELECT COUNT(*) FROM registrations
   WHERE event_id = $1 AND status = 'confirmed';
  IF count >= capacity -> rollback, 409
  SELECT existing row for (student_id, event_id);
    confirmed -> 409 duplicate
    waitlisted -> 409 duplicate
    cancelled -> UPDATE back to confirmed (reactivate)
    absent    -> INSERT confirmed
COMMIT
```

The event-row lock is held until commit, so two students racing for the last seat
are serialised: the second transaction sees the first insert in its count. The
`UNIQUE (student_id, event_id)` constraint prevents duplicate rows even if two
requests arrive for the same student, and the trigger re-checks capacity while
locking the same event row.

### 14.2 Other transactional workflows

- **Registration cancellation** is a single conditional `UPDATE` that requires
  `status = 'confirmed'` and `NOT EXISTS` an attendance row, so it cannot race
  with attendance marking.
- **Bulk attendance** verifies every registration belongs to the event and is
  confirmed inside one transaction; if one entry is invalid, none is saved.
- **Certificate issuance** selects present attendees without a certificate and
  calls `fn_award_certificate` inside one transaction. The function's
  `ON CONFLICT DO NOTHING` plus the unique constraint make retries safe.
- **Registration creation** (user + student) and **admin student creation** use a
  transaction so a failure never leaves an account without a profile.

### 14.3 Isolation

The default `READ COMMITTED` isolation is sufficient because the critical
capacity decision is protected by an explicit row lock, not by snapshot
isolation. Lost updates are prevented by `FOR UPDATE`; phantom duplicates are
prevented by unique constraints. Deadlocks are unlikely because the registration
path locks a single event row in a consistent order.

---

## 15. Security and validation

| Area | Implementation |
|---|---|
| Password storage | bcrypt cost 12; only the hash is stored; hash never serialized |
| Session | HS256 JWT in `HttpOnly` `cc_session` cookie; default 24h TTL |
| CSRF | Double-submit `cc_csrf` cookie + `X-CSRF-Token`; Bearer clients exempt |
| Authorization | Auth middleware reloads role/student id from the database each request; `RequireRole`; service-level club ownership checks |
| SQL injection | All values use pgx placeholders; dynamic SQL only interpolates generated placeholder numbers and trusted fragments |
| Input validation | `validator` on DTOs, custom password/enrollment checks, JSON `DisallowUnknownFields`, 1 MiB body limit |
| Enumeration safety | Unknown IDs return `404`; login failures use one generic message |
| Error hygiene | Unexpected errors are logged and replaced with "Something went wrong"; no database details reach clients |
| CORS | Only `FRONTEND_URL` is allowed; credentials enabled for cookie auth |
| Secrets | `DATABASE_URL`, `JWT_SECRET` and cookie policy stay server-side; Vite only sees `VITE_API_URL` |
| Database integrity | PK/FK/UNIQUE/CHECK/NOT NULL plus triggers for cross-row rules |
| Least privilege | Reporting views can be granted to a read-only role (see SQL Q51) |

Account deactivation is checked on every request, so a stolen cookie stops
working as soon as the admin disables the account. Coordinators can only manage
clubs for which they hold an approved coordinator membership; admins bypass that
check intentionally.

---

## 16. API summary

Base path `/api/v1`; success envelope `{data}`, paginated `{data, meta}`, failure
`{error:{code,message,fields?}}`. Full request/response examples are in
`docs/api-documentation.md`.

| Group | Examples | Notes |
|---|---|---|
| Public | `POST /auth/register`, `POST /auth/login`, `GET /departments`, `GET /venues`, `GET /clubs`, `GET /clubs/{id}`, `GET /events`, `GET /events/{id}` | Event endpoints accept optional auth to attach `myRegistration` |
| Account | `GET/PATCH /auth/me`, `POST /auth/change-password`, `POST /auth/logout` | Cookie + CSRF for unsafe methods |
| Student | `POST /clubs/{id}/join`, `GET /me/memberships`, `GET /me/registrations`, `GET /me/certificates`, `GET /me/dashboard`, `POST /events/{id}/register`, `DELETE /registrations/{id}`, `GET/POST /events/{id}/feedback` | Self-service and ownership rules |
| Coordinator | `GET /coordinator/dashboard`, `POST/PATCH/DELETE /events`, `GET /events/{id}/registrations`, `GET /events/{id}/stats`, `POST /events/{id}/attendance`, `POST /events/{id}/certificates`, `GET/PATCH /clubs/{id}/members...` | Admin may also call; ownership enforced |
| Admin | `/admin/dashboard`, `/admin/users`, `/admin/students`, `/admin/departments`, `/admin/venues`, `/admin/clubs`, `/admin/events`, `PATCH /admin/events/{id}/status` | `RequireRole("admin")` |

Pagination uses `page` (default 1), `pageSize` (default 12, max 100) and
`search`; `meta` reports `total` and `totalPages`. Business failures use `409`,
field validation uses `422 validation_error` with a `fields` map, and CSRF
failures use `403 csrf_failed`.

---

## 17. Frontend summary

The frontend is a Vite 8 / React 19 / TypeScript 7 SPA styled with Tailwind 4.

- **Public:** login and registration pages with React Hook Form + Zod, including
  department selection from `GET /departments`.
- **Student:** dashboard, club directory and detail, event list and detail,
  registrations and certificates. Registration/cancellation mutations invalidate
  both event and "my registrations" queries.
- **Coordinator:** dashboard, event list, create/edit form, membership review,
  and an attendance screen that marks present/absent and surfaces certificate
  codes.
- **Admin:** dashboard with Recharts, student management, club approval and
  coordinator assignment, event approval, venue and department CRUD.
- **Shared:** profile page, responsive app shell, role guards, `PageHeader`,
  cards, tables, modals, pagination, search, empty/loading/error states,
  `EventCard`, `CapacityBar`, `StarRating`, toasts via Sonner.
- **Data layer:** a single `services/api.ts` wrapper adds `credentials: include`,
  reads `cc_csrf`, attaches `X-CSRF-Token`, unwraps the envelope and throws a
  typed `ApiError` with `fields` for form mapping. No component calls `fetch`
  directly.
- **Auth context:** `useAuth()` exposes user, login, register, logout and refresh;
  route guards are UX only, with the backend remaining authoritative.

The production build (`npm run build`: `tsc -b && vite build`) passes. Vite warns
that the main chunk is larger than 500 kB; route-level code splitting is listed
under future work.

---

## 18. Testing strategy and results

**Database**

- Constraint tests are scripted in `docs/sql-queries.sql` Q31–Q43: duplicate
  email, invalid role, out-of-range rating, missing department FK, duplicate
  registration, membership decision check, deadline check, `RESTRICT` deletes,
  cascade behaviour, venue-capacity trigger, capacity trigger and duplicate
  attendance. Expected SQLSTATEs are documented next to each test.
- Join, aggregate, subquery, CTE, window, view, index, transaction, trigger and
  function demos are Q1–Q55.
- The seed script is deterministic and ends with counts for all 11 tables.

**Backend**

- `go build ./...` passes for the whole module.
- `backend/tests/embedded_bootstrap_test.go` starts an embedded PostgreSQL 17
  instance and verifies connectivity. It is skipped in `-short` mode and is the
  harness for repository-level integration tests.
- Service rules were exercised through handler/repository review and the SQL
  constraint tests. Full HTTP integration tests require a live PostgreSQL/Neon
  `DATABASE_URL`, which is not available in the current evaluation environment;
  no destructive test was run against production data.

**Frontend**

- `npm run build` passes (TypeScript project build + Vite production build).
- The project includes Vitest, React Testing Library and jsdom as the test
  harness; no committed component tests currently exist (future work).
- Manual flows targeted: login/register, role navigation, club join, event
  register/cancel, membership approval, attendance and certificate display.

**Result summary**

| Check | Result |
|---|---|
| `go build ./...` | Pass |
| `npm run build` | Pass (chunk-size warning) |
| Migration SQL review | Pass; 11 tables, 5 views, 7 functions, 8 triggers |
| Seed SQL review | Pass; deterministic, transactional, relative dates |
| SQL demo script | 55 numbered queries; 14 expected-error tests isolated by rollback |
| Live Neon integration | Not run in this environment — requires `DATABASE_URL` |

---

## 19. Deployment notes

**Environment variables (backend)**

```env
PORT=8080
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
JWT_SECRET=<at-least-32-random-characters>
FRONTEND_URL=https://campusconnect.example
APP_ENV=production
AUTO_MIGRATE=true
SECURE_COOKIES=true
COOKIE_SAME_SITE=none
JWT_TTL=24h
```

**Procedure**

1. Create a Neon project and copy the pooled connection string.
2. Deploy the Go API with the variables above; Goose applies the embedded
   migrations on boot (`AUTO_MIGRATE=true`). For controlled releases, run the
   migration step separately and set `AUTO_MIGRATE=false`.
3. Seed only development/demo databases with `psql "$DATABASE_URL" -f seeds/seed.sql`;
   never seed production.
4. Build the frontend with `VITE_API_URL=https://api.example/api/v1 npm run build`
   and serve `frontend/dist` from a static host.
5. Set `FRONTEND_URL` to the exact static origin so CORS and cookies line up.
   Cross-site cookies require `Secure` and usually `SameSite=None`.
6. Verify `GET /healthz`, login cookies, CSRF on a mutation, role guards and one
   complete registration flow.
7. Keep `DATABASE_URL` and `JWT_SECRET` out of the repository and out of any
   `VITE_` variable.

The repository is deployment-ready but no live public URL is committed; the
evaluation environment used here has no running database.

**Screenshot placeholders** (capture and place in `docs/screenshots/`; images are
not committed in this change):

| File | Capture |
|---|---|
| `docs/screenshots/01-login.png` | Login page and error state |
| `docs/screenshots/02-register.png` | Registration form with department select |
| `docs/screenshots/03-student-dashboard.png` | Student counts and upcoming events |
| `docs/screenshots/04-clubs.png` | Club directory/search |
| `docs/screenshots/05-event-detail.png` | Event detail with capacity and register button |
| `docs/screenshots/06-registrations.png` | Registration history |
| `docs/screenshots/07-certificates.png` | Certificate list |
| `docs/screenshots/08-coordinator-dashboard.png` | Coordinator stats and pending members |
| `docs/screenshots/09-members.png` | Membership approval table |
| `docs/screenshots/10-attendance.png` | Attendance marking with certificate codes |
| `docs/screenshots/11-admin-dashboard.png` | Admin charts and pending approvals |
| `docs/screenshots/12-admin-events.png` | Event approval workflow |
| `docs/screenshots/13-query-output.png` | psql output of joins/aggregates |
| `docs/screenshots/14-explain-plan.png` | `EXPLAIN ANALYZE` index demonstration |

---

## 20. Evaluation checklist mapping

| Requirement | Artifact / evidence |
|---|---|
| ER diagram in ERDPlus, Chen notation | `docs/er-diagram.md` §3 (entities, diamonds, ovals, underlined PKs, cardinalities, export steps) |
| Relational schema | `backend/migrations/00001_schema.sql`; `docs/database-design.md` |
| 11 tables | `users`, `departments`, `students`, `clubs`, `club_members`, `venues`, `events`, `registrations`, `attendance`, `feedback`, `certificates` |
| 3NF / functional dependencies | Report §8; candidate keys and FDs for all 11 relations |
| DDL | `00001_schema.sql`, `00002_functions_triggers.sql`, `00003_views.sql` |
| DML | `docs/sql-queries.sql` Q30 (insert/update/delete in a rolled-back transaction) |
| Primary/foreign keys | Schema §2; report §10; 14 FKs |
| UNIQUE and composite keys | `(student_id, club_id)`, `(student_id, event_id)`, unique registration on attendance/certificate, unique email/name/code |
| CHECK constraints | Role, status, rating, capacity, deadline, cancellation and decision checks |
| INNER JOIN | Q3 (events/clubs/venues), Q4 (five-table registration detail) |
| LEFT JOIN | Q5 (clubs with zero members), Q6 (events with zero registrations) |
| GROUP BY | Q7 (counts by event), Q16 (membership funnel) |
| HAVING | Q8 (events with ≥10 confirmed) |
| Aggregates | Q9 (average/min/max feedback), Q53 (platform counts) |
| Subqueries | Q10 (above-average), Q11 (correlated department average), Q12/Q13 (`EXISTS`/`NOT EXISTS`) |
| CTEs | Q15 (event performance), Q16 (membership funnel), Q17/Q20 (window staging) |
| Window functions | Q17 `ROW_NUMBER`, Q18 `RANK`/`DENSE_RANK`, Q19 running total, Q20 `LAG` |
| Views | `upcoming_events`, `event_registration_summary`, `club_membership_summary`, `student_registration_history`, `platform_stats`; Q21–Q25 |
| Indexes | 12 explicit indexes; Q26–Q29 `EXPLAIN (ANALYZE, BUFFERS)` |
| Transactions | Q44 capacity transaction; report §14 |
| Concurrency | `SELECT ... FOR UPDATE` + unique constraint + capacity trigger |
| Trigger | `updated_at` (Q45), venue capacity (Q41), registration capacity (Q42), attendance → certificate (Q46–Q47) |
| Stored function/procedure | `fn_event_stats` (Q48–Q49), `fn_award_certificate` (Q50) |
| Constraint tests | Q31–Q43 with expected SQLSTATEs |
| Privilege/security | Q51 read-only reporting role; report §15 |
| Seed data | `backend/seeds/seed.sql`; 5 departments, 32 users, 31 students, 8 clubs, 8 venues, 14 events |
| REST API | `docs/api-documentation.md`; Go router/handlers/services/repositories |
| Role-based dashboards | Student, coordinator and admin pages under `frontend/src/pages/` |
| API documentation | `docs/api-documentation.md` (all 45 live routes) |
| Project report | This document |
| Screenshots | Placeholder table in §19 (`docs/screenshots/`) |
| Deployment | §19 procedure; environment variables, Neon, CORS, cookies |

---

## 21. Limitations and future work

1. **Waitlist is modelled but not automated.** `registrations.status` allows
   `waitlisted`, but the API only creates `confirmed` rows. A future job could
   promote waitlisted students when a seat is released.
2. **No notifications.** There is no email/SMS integration for decisions,
   deadlines or certificates.
3. **Certificates are printed client-side.** There is no server-side PDF or
   signed download URL.
4. **No refresh-token rotation.** A single 24h JWT is used; revocation relies on
   account deactivation and expiry.
5. **No rate limiting or CAPTCHA** on login/registration.
6. **Search is `ILIKE`**, not PostgreSQL full-text search; it is adequate for a
   campus dataset but not for large corpora.
7. **No cursor pagination.** Offset pagination is simple but can drift on large,
   frequently changing lists.
8. **No row-level security.** Authorization is enforced in Go; PostgreSQL RLS
   could add another layer for direct database consumers.
9. **Attendee certificate codes are derived from registration id and year**, so
   re-issuing in a later year would collide with the unique code and return the
   original certificate (intentional idempotency, but not a re-issue workflow).
10. **Frontend test coverage is thin.** The Vitest/RTL harness exists, but
    component tests still need to be written.
11. **Bundle size.** The main JS chunk exceeds Vite's 500 kB warning; route-level
    dynamic imports are the next optimisation.
12. **Live deployment is pending.** The code and runbook are present, but no
    public URL or Neon instance is committed in this environment.

---

## 22. Conclusion

CampusConnect demonstrates that a full-stack application can be built around a
carefully normalised relational core without hiding the database behind an ORM.
The 11-table schema separates identity from profile data, resolves both
many-to-many relationships with well-constrained junctions, and preserves
historical facts through deliberate `RESTRICT` policies. Constraints, triggers and
stored functions enforce the rules that matter — capacity, venue size, attendance
preconditions, certificate uniqueness and audit timestamps — even if application
code is bypassed. The registration transaction shows how row-level locking and
unique constraints combine to make a realistic concurrency problem safe.

The Go API exposes the schema through a consistent, documented REST interface with
cookie authentication, CSRF protection and role-based authorization. The React
frontend turns those endpoints into three coherent dashboards. The SQL script,
ER documentation and data dictionary make every RDBMS concept inspectable during
evaluation rather than merely asserted. With a Neon connection string and the
documented environment variables, the project can be migrated, seeded and
deployed; the remaining work is operational hardening and the future enhancements
listed above.
