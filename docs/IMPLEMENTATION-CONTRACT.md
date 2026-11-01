# CampusConnect — Implementation Contract

This document is the shared contract for all implementation work. Follow it
exactly so independently-built slices fit together.

## Repository layout

```
backend/                Go API (module github.com/campusconnect/backend)
  cmd/api               server entrypoint
  cmd/seed              database seeder
  internal/
    apperr              transport-safe errors
    auth                JWT, bcrypt, CSRF token helpers
    authctx             request principal in context
    config              env configuration
    database            pgxpool + Goose migrations
    handlers            HTTP layer
    httpx               JSON envelope, pagination, decoding
    middleware          auth, RBAC, CSRF, CORS, logging
    models              shared response models (camelCase JSON)
    repositories        parameterized SQL only
    server              router + dependency wiring
    services            business rules
  migrations            Goose SQL (embedded, source of truth)
  seeds/seed.sql        demo data
frontend/               Vite + React + TypeScript + Tailwind
docs/                   API docs, SQL demo, report
```

## Layers

- **Handlers** parse/validate HTTP, call services, write envelopes. Never SQL.
- **Services** enforce business rules and authorization. Never SQL.
- **Repositories** execute parameterized SQL via `pgx`. No HTTP types.
- **Models** are JSON DTOs shared across layers; `json` tags are camelCase.

## JSON envelope

Success:

```json
{ "data": <payload> }
```

Paginated success:

```json
{ "data": [ ... ], "meta": { "page": 1, "pageSize": 12, "total": 42, "totalPages": 4 } }
```

Failure:

```json
{ "error": { "code": "conflict", "message": "You are already registered.", "fields": { "email": "..." } } }
```

Use `httpx.JSON`, `httpx.Paginated`, `httpx.Created`, `httpx.NoContent`,
`httpx.FailError`. Return `apperr.*` errors from services; handlers pass them to
`httpx.FailError`.

Codes: `bad_request` (400), `unauthorized` (401), `forbidden` (403),
`not_found` (404), `conflict` (409), `validation_error` (422),
`internal_error` (500). Invalid payloads must include `fields`.

## Auth and authorization

- Session JWT in HttpOnly cookie `cc_session`; CSRF token in readable cookie
  `cc_csrf`, echoed in `X-CSRF-Token` for unsafe methods. Bearer tokens are
  accepted for API clients (and exempt from CSRF).
- The auth middleware loads the principal from the database on every request:
  `authctx.Principal{UserID, Email, Role, StudentID *int64}`. Use
  `authctx.MustFromRequest(r)`.
- Route groups in `internal/server/router.go` already apply auth + CSRF.
  - `registerXPublicRoutes(api chi.Router, deps Deps)` — unauthenticated.
  - `registerXProtectedRoutes(r chi.Router, deps Deps)` — authenticated.
  - `registerAdminProtectedRoutes` must also use
    `middleware.RequireRole("admin")`.
- Do not trust a client-supplied role or student ID.
- A coordinator manages a club iff their student profile has an approved
  `club_members` row with `role = 'coordinator'` for that club. Admins bypass.
- Students may act on their own records only.
- Login/register responses set cookies:
  - `cc_session`: `HttpOnly`, `Path=/`, `Secure` from config, `SameSite` from
    config, `MaxAge` = JWT TTL.
  - `cc_csrf`: readable by JS, same path/expiry.
- `POST /auth/logout` clears both cookies.

## Date/time

Store and return `timestamptz` (RFC3339 JSON). The API returns camelCase field
names. The database uses snake_case.

## Pagination and list conventions

- Query params: `page` (default 1), `pageSize` (default 12, max 100), `search`.
- Use `httpx.Pagination(r)`; return the total count from a second query or a
  window function.
- Reject unknown IDs with 404 rather than leaking whether a row exists.

## Endpoint contract

Base path: `/api/v1`. `A` = authenticated, all roles unless stated.

### Auth

| Method | Path | Auth | Body / query | Response `data` |
|---|---|---|---|---|
| POST | `/auth/register` | public | `{email,password,fullName,enrollmentNumber,departmentId}` | `SessionUser` + cookies, 201 |
| POST | `/auth/login` | public | `{email,password}` | `SessionUser` + cookies |
| GET | `/auth/me` | A | — | `SessionUser` |
| PATCH | `/auth/me` | A | `{fullName?, departmentId?}` (student profile required) | `SessionUser` |
| POST | `/auth/change-password` | A | `{currentPassword,newPassword}` | 204 |
| POST | `/auth/logout` | A | — | 204, clears cookies |

`SessionUser` = `{userId,email,role,isActive,createdAt,student?}` where student is
`{studentId,userId,email,fullName,enrollmentNumber,departmentId,departmentName,isActive,createdAt}`.
Never return `password_hash`.

Registration creates `users` (role `student`) + `students` in one transaction.
Password: min 8 chars, at least one letter and one number. Email lowercased.
Enrollment trimmed and uppercased; unique. Requires an existing department.
On register, log in immediately by setting cookies.

### Directory

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/departments` | public | `data: Department[]` (`studentCount` included) |
| GET | `/venues` | public | `data: Venue[]` (`eventCount` included) |
| GET | `/clubs` | public | approved clubs only; `search,page,pageSize` |
| GET | `/clubs/{id}` | public | approved club; 404 otherwise |
| GET | `/events` | public | published/upcoming by default; filters below |
| GET | `/events/{id}` | public | published or completed; 404 otherwise |
| GET | `/students/{id}/certificates` | A | owner, admin, or coordinator of that student's club; `Certificate[]` |

`GET /events` filters: `search`, `clubId`, `status` (published default; admin/
coordinator may request others with scope), `upcoming` (`true` default → event
date >= now), `page`, `pageSize`, `scope=managed` (coordinator) or `scope=all`
(admin). Students/public only see published events. `GET /events/{id}` returns
`Event` with live counts and `myRegistration` when the caller is a student with
a registration.

### Student / self

| Method | Path | Auth | Body / query | Response |
|---|---|---|---|---|
| POST | `/clubs/{id}/join` | A (student profile) | — | `MembershipRequest`, 201 or 200 if re-request |
| GET | `/me/memberships` | A (student profile) | — | `MembershipRequest[]` |
| GET | `/me/registrations` | A (student profile) | `page,pageSize,status` | paginated `Registration[]` |
| GET | `/me/certificates` | A (student profile) | — | `Certificate[]` |
| GET | `/me/dashboard` | A (student profile) | — | `StudentDashboard` |
| GET | `/me/coordinated-clubs` | coordinator | — | `Club[]` |

Membership rules: club must be approved; no existing approved membership;
a rejected/pending row may be re-requested by updating it to pending and
clearing decision fields. Never duplicate rows.

### Events and registrations

| Method | Path | Auth | Body / query | Response |
|---|---|---|---|---|
| POST | `/events` | coordinator/admin | `{clubId,venueId,title,description,eventDate,registrationDeadline,capacity}` | `Event`, 201 (status `pending`) |
| PATCH | `/events/{id}` | coordinator of club/admin | same fields partial + `status?` (admin only for status) | `Event` |
| DELETE | `/events/{id}` | coordinator of club/admin | — | 204; reject with 409 if registrations exist |
| POST | `/events/{id}/register` | A (student profile) | — | `Registration`, 201 |
| GET | `/events/{id}/registrations` | coordinator of club/admin | `page,pageSize,status` | paginated `Registration[]` |
| GET | `/events/{id}/feedback` | A | — | `Feedback[]` (coordinator/admin see all; students see own) |
| POST | `/events/{id}/feedback` | A (student profile) | `{rating,comments}` | `Feedback`, 201 |
| GET | `/events/{id}/stats` | coordinator of club/admin | — | `EventStats` |
| POST | `/events/{id}/attendance` | coordinator of club/admin | `{entries:[{registrationId,status}]}` | `Attendance[]` |
| POST | `/events/{id}/certificates` | coordinator of club/admin | — | `{issued:int,certificates:Certificate[]}` |
| POST | `/registrations/{id}/attendance` | coordinator/admin | `{status:'present'|'absent'}` | `Attendance` |
| DELETE | `/registrations/{id}` | owner/admin | — | 204; sets status `cancelled` |
| GET | `/coordinator/dashboard` | coordinator | — | `CoordinatorDashboard` |

Registration transaction (required):
1. `BEGIN`.
2. `SELECT ... FROM events WHERE event_id=$1 FOR UPDATE`.
3. Verify status `published`, deadline not passed, event not started.
4. Count confirmed registrations; verify capacity.
5. Insert or reactivate the registration. Unique `(student_id,event_id)`.
6. `COMMIT`; roll back on any failure.
Return 409 for capacity/duplicate/closed registration.

Feedback only from a student with a confirmed registration, after the event has
started; one row per student/event. `POST /events/{id}/certificates` calls
`fn_award_certificate(registration_id)` for present attendees and is idempotent.

Attendance marking may create/replace the attendance row; present attendance
auto-issues a certificate (database trigger `trg_attendance_issue_certificate`).
The service must verify the registration belongs to the event.

### Admin

| Method | Path | Body / query | Notes |
|---|---|---|---|
| GET | `/admin/dashboard` | — | `AdminDashboard` |
| GET | `/admin/users` | `search,role,page,pageSize` | paginated `User[]` |
| PATCH | `/admin/users/{id}` | `{isActive?, role?}` | cannot deactivate self; role change must keep student profile consistent |
| GET | `/admin/students` | `search,departmentId,page,pageSize` | paginated `Student[]` |
| POST | `/admin/students` | `{email,password,fullName,enrollmentNumber,departmentId,role?}` | creates user+student, 201 |
| PATCH | `/admin/students/{id}` | `{fullName?,departmentId?,enrollmentNumber?}` | `Student` |
| POST | `/admin/departments` | `{name,code}` | 201 |
| PATCH | `/admin/departments/{id}` | `{name?,code?}` | `Department` |
| DELETE | `/admin/departments/{id}` | — | 204; 409 if students reference it |
| POST | `/admin/venues` | `{name,capacity,location}` | 201 |
| PATCH | `/admin/venues/{id}` | `{name?,capacity?,location?}` | `Venue`; 409 if below existing event capacities |
| DELETE | `/admin/venues/{id}` | — | 204; 409 if events reference it |
| GET | `/admin/clubs` | `status,search,page,pageSize` | paginated `Club[]` |
| POST | `/admin/clubs` | `{name,description}` | 201, status `pending` unless `status` given |
| PATCH | `/admin/clubs/{id}` | `{name?,description?,status?}` | `Club` |
| POST | `/admin/clubs/{id}/coordinator` | `{studentId}` | upserts approved coordinator membership |
| DELETE | `/admin/clubs/{id}` | — | 204; 409 if events exist |
| GET | `/admin/events` | `status,search,page,pageSize` | paginated `Event[]` |
| PATCH | `/admin/events/{id}/status` | `{status,rejectionReason?}` | approve/reject/cancel/complete |

Admin event status transitions: `pending → published|rejected`,
`published → completed|cancelled`, `rejected → pending`.
`PATCH /events/{id}` must not change status (admin status endpoint is canonical).

### Coordinator

| Method | Path | Body / query | Notes |
|---|---|---|---|
| GET | `/coordinator/dashboard` | — | clubs they coordinate, stats, pending members, upcoming events, recent feedback |
| GET | `/clubs/{id}/members` | `status,search,page,pageSize` | coordinator/admin only |
| PATCH | `/clubs/{id}/members/{membershipId}` | `{status:'approved'|'rejected'}` | coordinator/admin; sets decided_at/by, joined_at on approval |
| PATCH | `/clubs/{id}/members/{membershipId}/role` | `{role:'member'|'coordinator'}` | coordinator/admin; cannot remove last coordinator of a club |

## Model shape reference

- `Club`: `clubId,name,description,status,createdAt,approvedMembers,pendingRequests,coordinatorName?,coordinatorEmail?,myRole?,myStatus?`
- `ClubMember`: `membershipId,studentId,clubId,clubName,fullName,email,enrollmentNumber,departmentName,role,status,requestedAt,decidedAt?,joinedAt?`
- `Venue`: `venueId,name,capacity,location,eventCount,createdAt`
- `Event`: `eventId,clubId,clubName,venueId,venueName,venueCapacity,createdBy?,title,description,eventDate,registrationDeadline,capacity,status,rejectionReason?,createdAt,updatedAt,confirmedRegistrations,totalRegistrations,seatsRemaining,averageRating?,feedbackCount,myRegistration?`
- `Registration`: `registrationId,studentId,eventId,studentName,email,enrollmentNumber,departmentName,clubName,eventTitle,eventDate,venueName,status,registeredAt,cancelledAt?,attendanceStatus?,certificateCode?,certificateId?`
- `Attendance`: `attendanceId,registrationId,studentId,studentName,enrollmentNumber,attendanceStatus,markedAt,certificateCode?`
- `Feedback`: `feedbackId,eventId,studentId,studentName,rating,comments,createdAt`
- `Certificate`: `certificateId,registrationId,certificateCode,issueDate,eventId,eventTitle,eventDate,clubName,studentName`
- `EventStats`: see `internal/models/event.go`
- Dashboards: see `internal/models/dashboard.go`

## File ownership (avoid edit collisions)

- Foundation (already written): config, database, httpx, apperr, auth, authctx,
  models, middleware, server/router.go, migrations, seed.
- Slice A (auth): `handlers/auth.go`, `services/auth.go`,
  `repositories/user.go`, `server/routes_auth.go`, auth DTOs in handler file.
- Slice B (admin/directory): `handlers/admin.go`, `services/admin.go`,
  `repositories/admin.go`, `server/routes_admin.go`.
- Slice C (clubs/me): `handlers/club.go`, `handlers/me.go`? clubs slice owns
  `handlers/club.go`, `services/club.go`, `repositories/club.go`,
  `server/routes_clubs.go`, `server/routes_me.go` (memberships + student
  dashboard).
- Slice D (events): `handlers/event.go`, `handlers/registration.go`,
  `services/event.go`, `services/registration.go`,
  `repositories/event.go`, `repositories/registration.go`,
  `server/routes_events.go`, `server/routes_coordinator.go`.
- Do not edit files owned by another slice. If a shared file truly must change,
  report it instead of editing.

## SQL / database facts

- 11 tables exactly: users, departments, students, clubs, club_members, venues,
  events, registrations, attendance, feedback, certificates.
- Unique `(student_id, club_id)` and `(student_id, event_id)`;
  `attendance.registration_id` and `certificates.registration_id` unique.
- `club_members` CHECK requires approved rows to have `decided_at` and
  `joined_at`; pending/rejected rows must not have `joined_at`.
- `events.status ∈ draft,pending,published,rejected,completed,cancelled`.
- `registrations.status ∈ confirmed,cancelled,waitlisted`.
- Trigger `trg_registrations_enforce_capacity` rejects over-capacity confirmed
  inserts. Trigger `trg_events_validate_venue_capacity` rejects event capacity >
  venue capacity. Trigger on attendance auto-issues certificates.
- Views: `upcoming_events`, `event_registration_summary`,
  `club_membership_summary`, `student_registration_history`, `platform_stats`.
- Functions: `fn_event_stats(bigint)`, `fn_award_certificate(bigint)`.
- All SQL must be parameterized. Use `$1, $2, ...`; never string concatenation
  for values.
