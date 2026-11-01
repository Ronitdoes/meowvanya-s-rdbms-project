# CampusConnect REST API Reference

**Base path:** `/api/v1`  
**Content type:** `application/json; charset=utf-8`  
**Authentication:** HttpOnly session cookie (`cc_session`) plus CSRF header, or a Bearer JWT for API clients.  
**Version:** v1 (routes mounted in `backend/internal/server/router.go`).

This reference is derived from the implementation contract and the actual route,
handler, service and repository files. Where the contract and router differ, the
router is authoritative.

---

## 1. Running the API

| Item | Value |
|---|---|
| Default port | `8080` (`PORT`) |
| Health check | `GET /healthz` (outside `/api/v1`) |
| Database | Neon PostgreSQL via `DATABASE_URL` |
| Migrations | Embedded Goose migrations, auto-applied when `AUTO_MIGRATE=true` |
| Frontend origin | `FRONTEND_URL` (default `http://localhost:5173`) |

`GET /healthz` returns `200` when the pool responds and `503` when it does not:

```json
{
  "status": "OK",
  "database": "up",
  "time": "2026-11-01T10:15:00.123456Z"
}
```

`/healthz` is not wrapped in the standard envelope.

---

## 2. Authentication, cookies and CSRF

### 2.1 Session model

`POST /auth/register` and `POST /auth/login` issue a signed HS256 JWT and set two
cookies:

| Cookie | HttpOnly | Readable by JS | Purpose |
|---|---:|---:|---|
| `cc_session` | Yes | No | Session JWT, `Path=/`, TTL from `JWT_TTL` (default 24h) |
| `cc_csrf` | No | Yes | Double-submit CSRF token, same path and lifetime |

Cookie attributes are controlled by configuration:

| Setting | Default | Meaning |
|---|---|---|
| `SECURE_COOKIES` | `false` (must be `true` in production) | Adds `Secure` |
| `COOKIE_SAME_SITE` | `lax` | `lax`, `strict` or `none`; `none` forces `Secure` |
| `COOKIE_DOMAIN` | empty | Optional cookie domain |

The JWT claims are `sub` (user id), `role`, `iss=campusconnect`,
`aud=campusconnect-web`, `iat`, `nbf`, `exp`. The middleware parses the token
and then **reloads the user from the database on every request**, so role
changes and deactivation take effect immediately. Inactive users receive `401`.

### 2.2 CSRF

Every unsafe method (`POST`, `PATCH`, `DELETE`, `PUT`) on a cookie-authenticated
request must echo the `cc_csrf` cookie value in the `X-CSRF-Token` header. Safe
methods (`GET`, `HEAD`, `OPTIONS`) are exempt.

Bearer-token requests are exempt because browsers do not attach the header
automatically. A failed CSRF check returns:

```json
{
  "error": {
    "code": "csrf_failed",
    "message": "The security token is missing or invalid. Refresh the page and try again."
  }
}
```

Status `403`. The frontend reads the readable cookie with
`document.cookie` and attaches the header in `frontend/src/services/api.ts`.

### 2.3 Role rules

- `student` — self-service only, and only with a student profile.
- `coordinator` — a student whose profile has an approved `club_members` row
  with `role = 'coordinator'` for the club. Coordinators manage only their clubs.
- `admin` — bypasses club-ownership checks and owns the admin surface.
- A missing student profile on an action that needs one returns `403`
  ("A student profile is required for this action.").
- Frontend route guards are convenience only; every rule is enforced here.

---

## 3. Response envelope

### 3.1 Success

```json
{ "data": { "clubId": 1, "name": "Coding Club" } }
```

### 3.2 Paginated success

Every paginated list adds `meta`:

```json
{
  "data": [ { "clubId": 1, "name": "Coding Club" } ],
  "meta": { "page": 1, "pageSize": 12, "total": 42, "totalPages": 4 }
}
```

### 3.3 Error

```json
{
  "error": {
    "code": "validation_error",
    "message": "Please correct the highlighted fields.",
    "fields": { "email": "Enter a valid email address." }
  }
}
```

`fields` is present for validation errors and maps camelCase request fields to
human-readable messages.

### 3.4 Error codes

| HTTP | `error.code` | Typical cause |
|---:|---|---|
| 400 | `bad_request` | Malformed JSON, unknown field, invalid path/query id, missing update fields |
| 401 | `unauthorized` | Missing/expired session, bad credentials, deactivated account |
| 403 | `forbidden` | Role or ownership failure |
| 403 | `csrf_failed` | Missing/mismatched CSRF cookie and header |
| 404 | `not_found` | Unknown record or record not visible to the caller |
| 409 | `conflict` | Duplicate business action, capacity full, closed registration, illegal status transition |
| 422 | `validation_error` | Field validation failure; includes `fields` |
| 422 | `unprocessable` | Business rule that is not a conflict (for example attendance on a non-confirmed registration) |
| 500 | `internal_error` | Unexpected error; details are logged, never returned |

Unknown routes return `404` with `{"error":{"code":"not_found",...}}`.

---

## 4. Pagination and list conventions

| Parameter | Default | Rules |
|---|---:|---|
| `page` | `1` | Values below 1 become 1; non-numeric falls back to 1 |
| `pageSize` | `12` | Values below 1 become 12; values above 100 are clamped to 100 |
| `search` | — | Trimmed; repository applies `ILIKE '%term%'` |

`meta.totalPages` is `ceil(total / pageSize)` and is `0` when there are no rows.
Unknown query parameters are ignored. Bad **path** IDs return `400`; unknown
record IDs return `404`.

---

## 5. Object shapes

Field names are camelCase in JSON; the database is snake_case. All timestamps are
RFC3339 `timestamptz` values.

### 5.1 `SessionUser`

```json
{
  "userId": 9,
  "email": "student09@campusconnect.test",
  "role": "student",
  "isActive": true,
  "createdAt": "2026-08-01T09:00:00Z",
  "student": {
    "studentId": 9,
    "userId": 9,
    "email": "student09@campusconnect.test",
    "fullName": "Anika Verma",
    "enrollmentNumber": "CSE2025009",
    "departmentId": 1,
    "departmentName": "Computer Science & Engineering",
    "isActive": true,
    "createdAt": "2026-08-01T09:00:00Z"
  }
}
```

`password_hash` is never returned. `student` is omitted for accounts without a
student profile. `csrfToken` is an optional field but the handlers set the token
through the cookie, not the body.

### 5.2 `Club`

```json
{
  "clubId": 1,
  "name": "Coding Club",
  "description": "Competitive programming, open-source and hack nights.",
  "status": "approved",
  "createdAt": "2025-09-27T10:00:00Z",
  "approvedMembers": 8,
  "pendingRequests": 2,
  "coordinatorName": "Priya Nair",
  "coordinatorEmail": "priya@campusconnect.test",
  "myRole": "member",
  "myStatus": "approved"
}
```

`coordinatorName`, `coordinatorEmail`, `myRole` and `myStatus` are optional and
depend on the endpoint/caller.

### 5.3 `Event`

```json
{
  "eventId": 6,
  "clubId": 1,
  "clubName": "Coding Club",
  "venueId": 1,
  "venueName": "Innovation Lab",
  "venueCapacity": 120,
  "createdBy": 1,
  "title": "CodeSprint 2026",
  "description": "A timed algorithmic contest.",
  "eventDate": "2026-11-06T10:00:00Z",
  "registrationDeadline": "2026-11-04T23:59:00Z",
  "capacity": 60,
  "status": "published",
  "rejectionReason": null,
  "createdAt": "2026-10-01T12:00:00Z",
  "updatedAt": "2026-10-02T12:00:00Z",
  "confirmedRegistrations": 14,
  "totalRegistrations": 15,
  "seatsRemaining": 46,
  "averageRating": 4.12,
  "feedbackCount": 6,
  "myRegistration": {
    "registrationId": 51,
    "status": "confirmed",
    "registeredAt": "2026-10-02T12:00:00Z",
    "attendanceStatus": null,
    "certificateCode": null
  }
}
```

`rejectionReason` appears only when set. `averageRating` is omitted when no
feedback exists. `myRegistration` appears only for an authenticated student who
has a registration for that event.

### 5.4 `Registration`

```json
{
  "registrationId": 51,
  "studentId": 4,
  "eventId": 6,
  "studentName": "Diya Kapoor",
  "email": "student04@campusconnect.test",
  "enrollmentNumber": "BBA2025004",
  "departmentName": "Business Administration",
  "clubName": "Coding Club",
  "eventTitle": "CodeSprint 2026",
  "eventDate": "2026-11-06T10:00:00Z",
  "venueName": "Innovation Lab",
  "status": "confirmed",
  "registeredAt": "2026-10-02T12:00:00Z",
  "cancelledAt": null,
  "attendanceStatus": null,
  "certificateCode": null,
  "certificateId": null
}
```

Optional fields (`cancelledAt`, `attendanceStatus`, `certificateCode`,
`certificateId`) are omitted when null.

### 5.5 `MembershipRequest` / `ClubMember`

```json
{
  "membershipId": 71,
  "clubId": 1,
  "clubName": "Coding Club",
  "status": "pending",
  "role": "member",
  "requestedAt": "2026-10-20T14:00:00Z"
}
```

`GET /clubs/{id}/members` returns the richer `ClubMember`:

```json
{
  "membershipId": 71,
  "studentId": 4,
  "clubId": 1,
  "clubName": "Coding Club",
  "fullName": "Diya Kapoor",
  "email": "student04@campusconnect.test",
  "enrollmentNumber": "BBA2025004",
  "departmentName": "Business Administration",
  "role": "member",
  "status": "approved",
  "requestedAt": "2026-10-01T14:00:00Z",
  "decidedAt": "2026-10-02T14:00:00Z",
  "joinedAt": "2026-10-02T14:00:00Z"
}
```

### 5.6 `Attendance`, `Feedback`, `Certificate`

```json
{
  "attendanceId": 12,
  "registrationId": 51,
  "studentId": 4,
  "studentName": "Diya Kapoor",
  "enrollmentNumber": "BBA2025004",
  "attendanceStatus": "present",
  "markedAt": "2026-11-06T12:00:00Z",
  "certificateCode": "CC-2026-000051"
}
```

```json
{
  "feedbackId": 8,
  "eventId": 1,
  "studentId": 6,
  "studentName": "Anika Verma",
  "rating": 5,
  "comments": "Excellent session, well organised and genuinely useful.",
  "createdAt": "2026-10-12T10:00:00Z"
}
```

```json
{
  "certificateId": 21,
  "registrationId": 51,
  "certificateCode": "CC-2026-000051",
  "issueDate": "2026-11-06T00:00:00Z",
  "eventId": 6,
  "eventTitle": "CodeSprint 2026",
  "eventDate": "2026-11-06T10:00:00Z",
  "clubName": "Coding Club",
  "studentName": "Diya Kapoor"
}
```

`issueDate` is a PostgreSQL `DATE`, serialized as midnight RFC3339.

### 5.7 `EventStats`

```json
{
  "eventId": 1,
  "title": "Hack the Campus 2026",
  "capacity": 60,
  "totalRegistrations": 22,
  "confirmedRegistrations": 22,
  "cancelledRegistrations": 0,
  "presentCount": 20,
  "absentCount": 2,
  "averageRating": 4.25,
  "feedbackCount": 11
}
```

### 5.8 Dashboards

`StudentDashboard`:

```json
{
  "clubsJoined": 3,
  "approvedMemberships": 2,
  "pendingMemberships": 1,
  "eventsRegistered": 5,
  "upcomingRegistrations": 2,
  "certificatesEarned": 1,
  "upcomingEvents": [ /* Event[] */ ],
  "recentRegistrations": [ /* Registration[] */ ]
}
```

`CoordinatorDashboard`:

```json
{
  "clubs": [ /* Club[] */ ],
  "stats": {
    "clubs": 1,
    "totalEvents": 6,
    "publishedEvents": 3,
    "upcomingEvents": 3,
    "approvedMembers": 8,
    "pendingMembers": 2,
    "totalRegistrations": 47,
    "certificatesIssued": 12,
    "averageRating": 4.1,
    "pendingEvents": 1
  },
  "pendingMembers": [ /* ClubMember[] */ ],
  "upcomingEvents": [ /* Event[] */ ],
  "recentFeedback": [ /* Feedback[] */ ]
}
```

`AdminDashboard`:

```json
{
  "stats": {
    "totalUsers": 32,
    "totalStudents": 31,
    "totalClubs": 8,
    "approvedClubs": 7,
    "pendingClubs": 1,
    "totalEvents": 14,
    "publishedEvents": 7,
    "pendingEvents": 2,
    "confirmedRegistrations": 150,
    "certificatesIssued": 67,
    "averageFeedbackRating": 4.0,
    "totalDepartments": 5,
    "totalVenues": 8
  },
  "pendingClubs": [ /* Club[] */ ],
  "pendingEvents": [ /* Event[] */ ],
  "recentRegistrations": [ /* Registration[] */ ],
  "registrationsByMonth": [ { "label": "2026-06", "value": 12 } ],
  "membersByClub": [ { "label": "Coding Club", "value": 8 } ],
  "feedbackDistribution": [ { "label": "5", "value": 12 } ]
}
```

The chart array values are implementation-driven; clients should treat them as
display data and not assume a fixed length.

---

## 6. Public endpoints

### 6.1 `POST /auth/register` — create a student account

**Auth:** public. **Success:** `201 Created`, `data: SessionUser`, sets cookies.

Request:

```json
{
  "email": "new.student@campusconnect.test",
  "password": "Password123!",
  "fullName": "New Student",
  "enrollmentNumber": "CSE2026099",
  "departmentId": 1
}
```

Rules:

- Email is trimmed and lower-cased; must be unique and valid.
- Password: at least 8 characters, at least one letter and one digit.
- Enrollment is trimmed and upper-cased; 4–24 letters, digits or dashes; unique.
- Department must exist.
- User and student profile are created in one transaction; role is `student`.
- Registration logs the user in immediately.

Errors: `422 validation_error` for field problems, including duplicate email
(`fields.email`) and duplicate enrollment (`fields.enrollmentNumber`);
`400 bad_request` for malformed JSON.

### 6.2 `POST /auth/login` — sign in

**Auth:** public. **Success:** `200 OK`, `data: SessionUser`, sets cookies.

```json
{ "email": "priya@campusconnect.test", "password": "Coordinator123!" }
```

Invalid credentials and inactive accounts both return `401 unauthorized` with
"Invalid email or password." (deliberately generic).

### 6.3 `GET /departments` — list departments

**Auth:** public. **Success:** `200 OK`, `data: Department[]` (not paginated).

```json
{
  "data": [
    {
      "departmentId": 1,
      "name": "Computer Science & Engineering",
      "code": "CSE",
      "studentCount": 7,
      "createdAt": "2026-08-01T09:00:00Z"
    }
  ]
}
```

### 6.4 `GET /venues` — list venues

**Auth:** public. **Success:** `200 OK`, `data: Venue[]` (not paginated).

```json
{
  "data": [
    {
      "venueId": 1,
      "name": "Innovation Lab",
      "capacity": 120,
      "location": "Engineering Block, Ground Floor",
      "eventCount": 4,
      "createdAt": "2026-08-01T09:00:00Z"
    }
  ]
}
```

### 6.5 `GET /clubs` — browse approved clubs

**Auth:** public. **Query:** `search`, `page`, `pageSize`.  
**Success:** `200 OK`, paginated `Club[]`. Only `status = 'approved'` clubs are
returned. `GET /clubs/{id}` returns `404` for a non-approved club.

```http
GET /api/v1/clubs?search=coding&page=1&pageSize=12
```

### 6.6 `GET /clubs/{id}` — club details

**Auth:** public. **Success:** `200 OK`, `data: Club`. **Errors:** `404`.

### 6.7 `GET /events` — browse published events

**Auth:** public, with optional auth. **Query:** `search`, `clubId`, `upcoming`
(`true` default; `false` includes past published events), `status`, `scope`,
`page`, `pageSize`.  
**Success:** `200 OK`, paginated `Event[]` ordered by event date.

Without `scope`, only `published` events are returned. `scope=managed` (coordinator
or admin) returns every status for the clubs the caller coordinates; `scope=all`
(admin only) returns every event. `status` narrows the scoped result to one of
`draft`, `pending`, `published`, `rejected`, `completed`, `cancelled`. Unknown
`scope` or `status` values → `422`; insufficient role → `403`.

Only `status = 'published'` events are listed. `search` matches event title or
club name. When a student is authenticated, each event receives
`myRegistration`. If a bearer/cookie token is invalid, the request is still
served as anonymous.

### 6.8 `GET /events/{id}` — event details

**Auth:** public, with optional auth. **Success:** `200 OK`, `data: Event` with
live confirmed/total counts, seats remaining, rating and (`student` caller)
`myRegistration`. Only `published` or `completed` events are visible; all other
statuses return `404`.

---

## 7. Authenticated account endpoints

All endpoints in this section and later require a valid session and, for unsafe
methods, the CSRF header.

### 7.1 `GET /auth/me` — current session

**Success:** `200 OK`, `data: SessionUser`. If the `cc_csrf` cookie is missing,
the handler issues a fresh token and sets the cookie. It does not rotate an
existing token (avoids breaking other tabs).

### 7.2 `PATCH /auth/me` — update own student profile

**Body (at least one):**

```json
{ "fullName": "Anika V. Verma", "departmentId": 2 }
```

**Success:** `200 OK`, `data: SessionUser`. Requires a student profile (`403`
otherwise). Blank names and unknown departments return `422`.

### 7.3 `POST /auth/change-password`

```json
{ "currentPassword": "Password123!", "newPassword": "NewPassword456!" }
```

**Success:** `204 No Content`. Rules: new password minimum 8 characters with a
letter and a digit, must differ from the current password. A wrong current
password returns `422 validation_error` with `fields.currentPassword`.

### 7.4 `POST /auth/logout`

**Success:** `204 No Content`; clears `cc_session` and `cc_csrf`. No body.

---

## 8. Student endpoints

### 8.1 `POST /clubs/{id}/join` — request membership

**Auth:** authenticated user with a student profile. **Body:** none.  
**Success:** `201 Created`, `data: MembershipRequest`.

Business rules:

- Club must exist and be approved; otherwise `404`.
- Already approved → `409` "You are already a member of this club."
- Pending request → `409` "Your membership request is awaiting review."
- A rejected row is reopened by setting it back to `pending` and clearing
  `decided_at`, `decided_by`, `joined_at`; no duplicate row is created.

### 8.2 `GET /me/memberships` — own membership requests

**Success:** `200 OK`, `data: MembershipRequest[]`, newest first.

### 8.3 `GET /me/registrations` — own event registrations

**Query:** `status` (`confirmed` | `cancelled` | `waitlisted`), `page`,
`pageSize`. **Success:** paginated `Registration[]`, newest first.

### 8.4 `GET /me/certificates` — own certificates

**Success:** `200 OK`, `data: Certificate[]`, newest issue date first.

### 8.5 `GET /me/dashboard` — student dashboard

**Success:** `200 OK`, `data: StudentDashboard` (counts, 4 upcoming events,
5 recent registrations). Requires a student profile (`403`).

### 8.6 `GET /me/coordinated-clubs` — clubs the caller coordinates

**Success:** `200 OK`, `data: Club[]`. Admins receive `[]`; users without a
student profile receive `403`. A coordinator must have an approved
`club_members` row with `role = 'coordinator'`.

### 8.7 `POST /events/{id}/register` — register for an event

**Auth:** student profile. **Body:** none. **Success:** `201 Created`,
`data: Registration`.

Business rules (executed in one transaction; see §12):

- Event must exist, be `published`, before its deadline and not started.
- Confirmed registrations must be below capacity.
- Duplicate confirmed/waitlisted registration → `409`.
- A previously cancelled registration is reactivated (`status = 'confirmed'`,
  `registered_at` reset, `cancelled_at` cleared) rather than duplicated.
- `404` for an unknown event; `409` for closed/full/duplicate.

### 8.8 `DELETE /registrations/{id}` — cancel own registration

**Auth:** owner or admin. **Success:** `204 No Content`.

Rules: only a `confirmed` registration can be cancelled; attendance already
recorded blocks cancellation (`409`); non-owners receive `403`. Cancellation is a
status update (`cancelled`, `cancelled_at`), not a row delete, preserving history.

### 8.9 `GET /events/{id}/feedback` — read feedback

**Auth:** authenticated.

- Admin: all feedback for the event.
- Coordinator of the event's club: all feedback for that event.
- Student: only feedback for events where they have a confirmed registration;
  otherwise `403`. Returns only their own feedback rows.

**Success:** `200 OK`, `data: Feedback[]`.

### 8.10 `POST /events/{id}/feedback` — submit feedback

```json
{ "rating": 5, "comments": "Excellent session." }
```

**Success:** `201 Created`, `data: Feedback`.

Rules: rating 1–5; comments at most 1000 characters; event must have started;
caller must have a confirmed registration; one feedback row per student/event
(duplicate → `409`). Feedback before the event start → `409`.

### 8.11 `GET /students/{id}/certificates` — view another student's certificates

**Auth:** the student themselves, an admin, or a coordinator of a club that the
student is an approved member of. **Success:** `200 OK`,
`data: Certificate[]`. Unknown student → `404`; unauthorised → `403`.

---

## 9. Coordinator (and admin) endpoints

The service rule is "admin, or an approved coordinator of the event's club".
Admins bypass ownership. A non-manager receives `403`; an unknown club/event
receives `404`.

### 9.1 `GET /coordinator/dashboard`

**Auth:** `coordinator` role only. **Success:** `200 OK`,
`data: CoordinatorDashboard`. Includes coordinated clubs, stats, up to 10 pending
members, 5 upcoming events and 5 recent feedback rows.

### 9.2 `POST /events` — create an event

```json
{
  "clubId": 1,
  "venueId": 1,
  "title": "Algorithms Night",
  "description": "Weekly problem-solving session.",
  "eventDate": "2026-12-10T18:00:00Z",
  "registrationDeadline": "2026-12-08T23:59:00Z",
  "capacity": 45
}
```

**Success:** `201 Created`, `data: Event` with status `pending`.

Rules: caller must manage the club; club must be approved; event date must be in
the future; deadline must be in the future and on/before the event date; capacity
> 0 and ≤ venue capacity; title non-blank. Field failures → `422`.

### 9.3 `PATCH /events/{id}` — edit an event

**Body:** any of `clubId`, `venueId`, `title`, `description`, `eventDate`,
`registrationDeadline`, `capacity` (at least one). Status is **not** accepted
here; use the admin status endpoint.

**Success:** `200 OK`, `data: Event`. Completed/cancelled events → `409`.
Capacity cannot drop below confirmed registrations or exceed venue capacity.
Moving to another club requires managing that club too.

### 9.4 `DELETE /events/{id}`

**Success:** `204 No Content`. Any registration (including cancelled) blocks
deletion with `409`. The FK is also `ON DELETE RESTRICT` as defence in depth.

### 9.5 `GET /events/{id}/registrations`

**Query:** `status`, `search` (student name, email, enrollment), `page`,
`pageSize`. **Success:** paginated `Registration[]`, newest first.

### 9.6 `GET /events/{id}/stats`

**Success:** `200 OK`, `data: EventStats`, produced by `fn_event_stats`.

### 9.7 `POST /events/{id}/attendance` — bulk mark attendance

```json
{
  "entries": [
    { "registrationId": 51, "status": "present" },
    { "registrationId": 52, "status": "absent" }
  ]
}
```

**Success:** `200 OK`, `data: Attendance[]`.

Rules: at least one entry; each `registrationId` must belong to this event and be
`confirmed`; every registration is checked before the transaction commits.
`400` for a malformed entry/mismatched event; `422` for non-confirmed
registrations. Marking is an upsert on `attendance.registration_id`.

### 9.8 `POST /events/{id}/certificates` — bulk issue certificates

**Body:** none. **Success:** `200 OK`,
`data: { "issued": 2, "certificates": [ /* Certificate[] */ ] }`.

Only present attendees without a certificate are processed. Calls
`fn_award_certificate(registration_id)` and is idempotent. The attendance trigger
usually issues certificates earlier; this endpoint is the retry/backfill path.

### 9.9 `POST /registrations/{id}/attendance` — mark one registration

```json
{ "status": "present" }
```

**Success:** `200 OK`, `data: Attendance`. Manager of the event's club only.
Non-confirmed registration → `422`; unknown → `404`.

### 9.10 `GET /clubs/{id}/members` — review memberships

**Auth:** club coordinator or admin. **Query:** `status` (`pending`, `approved`,
`rejected`), `search`, `page`, `pageSize`. **Success:** paginated
`ClubMember[]`. Invalid status → `422`.

### 9.11 `PATCH /clubs/{id}/members/{membershipId}` — approve/reject

```json
{ "status": "approved" }
```

**Success:** `200 OK`, `data: ClubMember`.

Rules: status must be `approved` or `rejected`; only a `pending` request can be
decided (otherwise `409`); approval sets `decided_at`, `decided_by`, `joined_at`;
rejection sets `decided_at`/`decided_by` and leaves `joined_at` null, satisfying
the database decision check.

### 9.12 `PATCH /clubs/{id}/members/{membershipId}/role` — change role

```json
{ "role": "coordinator" }
```

**Success:** `200 OK`, `data: ClubMember`. Only approved members can change role
(`409`); a club must retain at least one approved coordinator (`409`).

### 9.13 `DELETE /clubs/{id}/members/{membershipId}` — remove a member

**Success:** `204 No Content`. Cannot remove the last approved coordinator
(`409`). Unknown membership → `404`.

### 9.14 `GET /coordinator/events` — managed events

**Auth:** `coordinator` role only. **Query:** `status`, `search`, `clubId`,
`upcoming` (`false` by default for this view), `page`, `pageSize`.

**Success:** `200 OK`, paginated `Event[]` for every club the caller coordinates,
including `pending`, `rejected`, `completed` and `cancelled` rows. This is the
event-editor roster; public discovery remains `GET /events`.

### 9.15 `GET /coordinator/events/{id}` — managed event details

**Auth:** coordinator of the event's club. **Success:** `200 OK`, `data: Event`
in any status. A coordinator of another club receives `403`; unknown event `404`.

> `GET /events?scope=managed` returns the same roster and is available to admins
> as well, while `scope=all` is the admin-wide view.

> **Note:** `DELETE /clubs/{id}/members/{membershipId}` is implemented in
> `routes_clubs.go` but is not listed in the original contract table. It is
> documented here because it is a live route.

---

## 10. Admin endpoints

Every route below is mounted behind `RequireRole("admin")`.

### 10.1 `GET /admin/dashboard`

**Success:** `200 OK`, `data: AdminDashboard`.

### 10.2 `GET /admin/users`

**Query:** `search` (email), `role`, `page`, `pageSize`. **Success:** paginated
`User[]` (each may embed `student`). Invalid role → `400`.

### 10.3 `PATCH /admin/users/{id}`

```json
{ "isActive": false, "role": "coordinator" }
```

At least one field required. **Success:** `200 OK`, `data: User`.

Rules: cannot deactivate your own account; cannot demote your own admin role;
student/coordinator roles require an existing student profile; unknown user →
`404`.

### 10.4 `GET /admin/students`

**Query:** `search`, `departmentId`, `page`, `pageSize`. **Success:** paginated
`Student[]`. A non-positive/invalid `departmentId` → `400`.

### 10.5 `POST /admin/students`

```json
{
  "email": "coord.new@campusconnect.test",
  "password": "Password123!",
  "fullName": "New Coordinator",
  "enrollmentNumber": "CSE2026100",
  "departmentId": 1,
  "role": "coordinator"
}
```

**Success:** `201 Created`, `data: Student`. Role is `student` by default and may
be `student` or `coordinator` (not `admin`). Creates user + student in one
transaction. Same password/enrollment/email rules as registration.

### 10.6 `PATCH /admin/students/{id}`

**Body:** `fullName`, `departmentId`, `enrollmentNumber` (at least one).  
**Success:** `200 OK`, `data: Student`.

### 10.7 Departments

| Method | Path | Body | Success |
|---|---|---|---|
| POST | `/admin/departments` | `{name, code}` | `201 Department` |
| PATCH | `/admin/departments/{id}` | `{name?, code?}` | `200 Department` |
| DELETE | `/admin/departments/{id}` | — | `204` |

`code` is upper-cased and must match `^[A-Z]{2,8}$`; names/codes are unique.
Deleting a department with students returns `409` (FK `ON DELETE RESTRICT`).

### 10.8 Venues

| Method | Path | Body | Success |
|---|---|---|---|
| POST | `/admin/venues` | `{name, capacity, location}` | `201 Venue` |
| PATCH | `/admin/venues/{id}` | `{name?, capacity?, location?}` | `200 Venue` |
| DELETE | `/admin/venues/{id}` | — | `204` |

Capacity must be > 0. Lowering capacity below an existing event's capacity
returns `409`; deleting a venue referenced by events returns `409`.

### 10.9 Clubs

| Method | Path | Body | Success |
|---|---|---|---|
| GET | `/admin/clubs` | query `status`, `search`, `page`, `pageSize` | paginated `Club[]` |
| POST | `/admin/clubs` | `{name, description, status?}` | `201 Club` |
| PATCH | `/admin/clubs/{id}` | `{name?, description?, status?}` | `200 Club` |
| POST | `/admin/clubs/{id}/coordinator` | `{studentId}` | `200 Club` |
| DELETE | `/admin/clubs/{id}` | — | `204` |

Club status is one of `pending|approved|rejected|inactive`; creation defaults to
`pending`. Coordinator assignment upserts an **approved coordinator** membership
for the student and records the admin as decider. Deleting a club with events
returns `409`; club memberships cascade.

### 10.10 Events

| Method | Path | Body/query | Success |
|---|---|---|---|
| GET | `/admin/events` | `status`, `search`, `page`, `pageSize` | paginated `Event[]` |
| PATCH | `/admin/events/{id}/status` | `{status, rejectionReason?}` | `200 Event` |

Allowed transitions:

| From | To |
|---|---|
| `pending` | `published`, `rejected` |
| `published` | `completed`, `cancelled` |
| `rejected` | `pending` |

Any other transition (including same-status) returns `409`. `rejectionReason` is
stored only when moving to `rejected`; blank values are ignored. `draft` and
`cancelled`/`completed` have no outbound transitions in this workflow.

---

## 11. Endpoint summary

| Group | Count | Endpoints |
|---|---:|---|
| Public | 8 | register, login, departments, venues, clubs list/detail, events list/detail |
| Account | 4 | me (GET/PATCH), change-password, logout |
| Student | 11 | join club, my memberships/registrations/certificates/dashboard, coordinated clubs, event register, cancel registration, feedback read/create, student certificates |
| Coordinator | 13 | dashboard, event create/update/delete, event registrations, stats, bulk attendance, bulk certificates, single attendance, members list/decide/role/remove |
| Admin | 19 | dashboard, users list/update, students list/create/update, departments create/update/delete, venues create/update/delete, clubs list/create/update/delete, set coordinator, events list, event status |

Some routes are shared by roles (for example `GET /events/{id}/feedback`); the
grouping above reflects the primary audience.

---

## 12. Business rules worth repeating

### 12.1 Capacity-safe registration

`POST /events/{id}/register` runs (in `RegistrationRepository.Register`):

1. `BEGIN`.
2. `SELECT status, capacity, deadline_ok, not_started FROM events WHERE event_id = $1 FOR UPDATE`.
3. Reject unless `status = 'published'`, the deadline has not passed and the
   event has not started.
4. `SELECT COUNT(*) FROM registrations WHERE event_id = $1 AND status = 'confirmed'`.
5. Reject when the count is at capacity.
6. Insert a confirmed registration, or reactivate a cancelled one.
7. `COMMIT`; any error rolls back.

The row lock serializes concurrent registrations for the same event. The unique
`(student_id, event_id)` constraint prevents duplicates, and the trigger
`trg_registrations_enforce_capacity` is a second line of defence even for direct
SQL.

### 12.2 Membership decisions

- Request: approved club only; one row per student/club; rejected rows are
  reopened rather than duplicated.
- Approval: `status='approved'`, `decided_at`, `decided_by`, `joined_at` set.
- Rejection: `decided_at`, `decided_by` set; `joined_at` stays null.
- A club must keep at least one approved coordinator; promoting/demoting/removing
  is blocked otherwise.

### 12.3 Attendance and certificates

- Attendance only for a confirmed registration and only by a club manager.
- Upsert semantics: one row per registration (`registration_id` unique).
- Present attendance triggers certificate issuance with code
  `CC-<year>-<zero-padded registration id>`.
- `fn_award_certificate` and `POST /events/{id}/certificates` are idempotent;
  retries return the existing certificate.
- The certificate download itself is a frontend print/export flow; there is no
  PDF endpoint.

### 12.4 Feedback

- Only a confirmed registrant may submit.
- Opens once `event_date` has passed (the event has started).
- One row per student/event; duplicate submission returns `409`.
- Ratings are constrained to 1–5 in both Go and PostgreSQL.

### 12.5 Deletion policy

| Deleted record | Effect |
|---|---|
| User | Student profile and memberships cascade; historical registrations still block student deletion via RESTRICT |
| Student | Memberships cascade; registrations/feedback block deletion |
| Club | Memberships cascade; events block deletion (`RESTRICT`) |
| Event | Registrations block deletion (`RESTRICT`); the API returns `409` first |
| Department | Students block deletion (`RESTRICT`) |
| Venue | Events block deletion (`RESTRICT`) |
| Registration | Attendance/certificate block deletion (`RESTRICT`) |

The API never hard-deletes registrations, attendance, feedback or certificates;
registration cancellation is a status change.

---

## 13. Example session flow

```http
POST /api/v1/auth/login
Content-Type: application/json

{ "email": "student09@campusconnect.test", "password": "Password123!" }
```

Response headers include:

```http
Set-Cookie: cc_session=...; Path=/; HttpOnly; SameSite=Lax
Set-Cookie: cc_csrf=...; Path=/; SameSite=Lax
```

Then:

```http
GET /api/v1/events?upcoming=true&pageSize=12
Cookie: cc_session=...; cc_csrf=...
```

and for a registration:

```http
POST /api/v1/events/6/register
Cookie: cc_session=...; cc_csrf=...
X-CSRF-Token: <cc_csrf value>
```

For a non-browser client, send
`Authorization: Bearer <jwt>` instead of cookies and omit the CSRF header.
Bearer tokens can be obtained from the JWT manager during development; the
public API intentionally exposes no token-printing endpoint.
