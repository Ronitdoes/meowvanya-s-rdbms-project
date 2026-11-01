# CampusConnect — Full-Stack Implementation Plan

**Project type:** College club and event management system  
**Complexity:** Moderate  
**Frontend:** Vite + React + TypeScript  
**Backend:** Go + Chi + pgx  
**Database:** Neon PostgreSQL

---

## 1. Project Overview

CampusConnect is a college club and event management platform. Students can discover clubs, request memberships, browse events, register, check attendance, submit feedback, and access certificates. Club coordinators manage their clubs and events, while administrators manage the overall platform.

The project is designed to demonstrate practical RDBMS concepts through a working full-stack application: relational modelling, normalization, primary and foreign keys, constraints, joins, aggregation, subqueries, views, indexes, transactions, triggers, and stored procedures.

## 2. Technology Stack

### Frontend

- **Vite + React + TypeScript** — frontend application.
- **Tailwind CSS** — styling.
- **React Router** — client-side routing.
- **TanStack Query** — API fetching, caching, and server state.
- **React Hook Form + Zod** — forms and validation.
- **Lucide React** — icons.
- **Recharts** — dashboard charts.

### Backend

- **Go** — application backend.
- **Chi** — HTTP router.
- **pgx/v5** — PostgreSQL driver and connection pool.
- **golang-jwt/jwt** — JWT authentication.
- **golang.org/x/crypto/bcrypt** — password hashing.
- **go-playground/validator** — request validation.
- **Goose** — SQL database migrations.

### Database

- **Neon PostgreSQL** — managed PostgreSQL database.
- Write SQL manually through `pgx`; do not use an ORM for this project. Manual SQL makes the RDBMS work visible and easier to explain during evaluation.

### Supporting tools

- Postman — API testing.
- ERDPlus — conceptual ER diagram.
- Git and GitHub — version control.
- Vitest and React Testing Library — frontend tests.
- Go `testing` and `httptest` — backend tests.

## 3. System Architecture

The application follows a three-tier architecture:

```text
┌───────────────────────────────────────────────┐
│              FRONTEND: VITE + REACT            │
│  Student Dashboard | Coordinator | Admin      │
└───────────────────────┬───────────────────────┘
                        │ HTTP REST / JSON
                        ▼
┌───────────────────────────────────────────────┐
│                  BACKEND: GO                   │
│                                               │
│  Chi Router                                   │
│      ↓                                        │
│  Middleware (Auth, RBAC, CORS)                │
│      ↓                                        │
│  Handlers → Services → Repositories            │
│                                               │
│                  pgx / pgxpool                 │
└───────────────────────┬───────────────────────┘
                        │ SQL
                        ▼
┌───────────────────────────────────────────────┐
│              NEON POSTGRESQL                   │
│  Tables | Constraints | Indexes | Views        │
│  Transactions | Triggers | Stored Procedures  │
└───────────────────────────────────────────────┘
```

### Example request flow: event registration

1. A student clicks **Register** in the frontend.
2. The frontend sends a `POST` request to the Go API.
3. Authentication middleware validates the user's token.
4. The handler validates the request payload.
5. The service checks event status, registration rules, and eligibility.
6. The repository executes a PostgreSQL transaction.
7. PostgreSQL commits the registration.
8. The API returns a JSON response.
9. TanStack Query updates the frontend state.

Keep HTTP handling, business rules, and SQL access in separate layers.

## 4. User Roles and Application Modules

### 4.1 Student

- Register and log in.
- View and update their profile.
- Browse college clubs.
- Request to join a club.
- View membership request status.
- Browse upcoming events.
- Register for events and cancel registrations.
- View registration history.
- Check attendance status.
- View or download certificates.
- Submit event feedback.

### 4.2 Club Coordinator

- View their club dashboard.
- Review and approve or reject membership requests.
- Create and edit club events.
- Select a venue and event capacity.
- View event registrations.
- Mark attendance for registered students.
- View event registration and attendance statistics.
- Review event feedback.

### 4.3 Administrator

- Manage user accounts and student records.
- Manage departments.
- Create and manage clubs.
- Assign club coordinators.
- Approve or reject clubs and events.
- Manage venues.
- View all events and registrations.
- View platform-wide statistics.

Authorization must be enforced by the backend. Hiding a frontend route is not sufficient security.

## 5. Database Design

Use the following 11-table design. The conceptual ER diagram should be drawn in ERDPlus using Chen notation: rectangles for entities, diamonds for relationships, ovals for attributes, underlined primary keys, and cardinality labels.

### 5.1 Tables and attributes

| Table | Important columns |
|---|---|
| `users` | `user_id` PK, `email` UNIQUE, `password_hash`, `role`, `is_active`, `created_at` |
| `departments` | `department_id` PK, `name` UNIQUE |
| `students` | `student_id` PK, `user_id` FK UNIQUE, `department_id` FK, `full_name`, `enrollment_number` UNIQUE |
| `clubs` | `club_id` PK, `name`, `description`, `created_at`, `status` |
| `club_members` | `membership_id` PK, `student_id` FK, `club_id` FK, `role`, `status`, `joined_at` |
| `venues` | `venue_id` PK, `name`, `capacity`, `location` |
| `events` | `event_id` PK, `club_id` FK, `venue_id` FK, `title`, `description`, `event_date`, `registration_deadline`, `capacity`, `status` |
| `registrations` | `registration_id` PK, `student_id` FK, `event_id` FK, `registered_at`, `status` |
| `attendance` | `attendance_id` PK, `registration_id` FK UNIQUE, `attendance_status`, `marked_at` |
| `feedback` | `feedback_id` PK, `student_id` FK, `event_id` FK, `rating`, `comments`, `created_at` |
| `certificates` | `certificate_id` PK, `registration_id` FK UNIQUE, `certificate_code` UNIQUE, `issue_date` |

**Design note:** Authentication belongs in `users`, while student-specific information belongs in `students`. This permits administrators and coordinators to have accounts without requiring student profiles. A student account has one optional student profile.

### 5.2 Relationships and cardinalities

| Relationship | Cardinality | Meaning |
|---|---:|---|
| Department — Student | 1:N | One department has many students. |
| User — Student | 1:0..1 | A user may have one student profile. |
| Student — ClubMember | 1:N | A student can have memberships in multiple clubs. |
| Club — ClubMember | 1:N | A club can have many members. |
| Club — Event | 1:N | A club can organize multiple events. |
| Venue — Event | 1:N | A venue can host multiple events over time. |
| Student — Registration | 1:N | A student can register for multiple events. |
| Event — Registration | 1:N | An event can have multiple registrations. |
| Registration — Attendance | 1:0..1 | A registration can have at most one attendance record. |
| Registration — Certificate | 1:0..1 | A registration can have at most one certificate. |
| Student — Feedback | 1:N | A student can submit feedback for multiple events. |
| Event — Feedback | 1:N | An event can receive feedback from multiple students. |

The Student–Club many-to-many relationship is resolved by `club_members`. The Student–Event many-to-many relationship is resolved by `registrations`.

### 5.3 Recommended constraints

- `users.email` must be unique.
- `students.user_id` must be unique.
- `students.enrollment_number` must be unique.
- `club_members(student_id, club_id)` must be unique.
- `registrations(student_id, event_id)` must be unique.
- `attendance.registration_id` must be unique.
- `certificates.registration_id` must be unique.
- `feedback(student_id, event_id)` must be unique.
- `feedback.rating` must be between 1 and 5.
- `venues.capacity` and `events.capacity` must be greater than zero.
- Use `CHECK` constraints for valid role and status values.
- Use foreign keys with deliberate `ON DELETE` rules. Prefer restricting deletion of historical registrations and certificates rather than cascading away records needed for reporting.

### 5.4 Normalization

Normalize the schema to at least 3NF:

- **1NF:** Store atomic values; do not store multiple clubs or events in one column.
- **2NF:** Ensure non-key attributes depend on the whole candidate key. Junction tables should not contain attributes that depend on only one side of a composite relationship.
- **3NF:** Avoid transitive dependencies. Department names belong in `departments`, not repeated in every student row; venue details belong in `venues`, not repeated in events.

Document any deliberate design choices in the project report.

## 6. Backend Architecture — Go

Use a layered architecture:

- **Handlers:** Parse HTTP requests, call services, and format responses.
- **Services:** Enforce business rules and coordinate operations.
- **Repositories:** Execute parameterized SQL queries.
- **Models:** Represent application data and request/response structures.
- **Middleware:** Authentication, role authorization, CORS, and request logging.
- **Database package:** Configure and expose the PostgreSQL connection pool.

### 6.1 Suggested folder structure

```text
backend/
├── cmd/
│   └── api/
│       └── main.go
├── internal/
│   ├── config/
│   │   └── config.go
│   ├── database/
│   │   └── postgres.go
│   ├── middleware/
│   │   ├── auth.go
│   │   ├── cors.go
│   │   └── rbac.go
│   ├── handlers/
│   │   ├── auth.go
│   │   ├── student.go
│   │   ├── club.go
│   │   ├── event.go
│   │   ├── registration.go
│   │   ├── attendance.go
│   │   └── admin.go
│   ├── services/
│   │   ├── auth.go
│   │   ├── club.go
│   │   ├── event.go
│   │   └── registration.go
│   ├── repositories/
│   │   ├── user.go
│   │   ├── student.go
│   │   ├── club.go
│   │   ├── event.go
│   │   └── registration.go
│   └── models/
│       ├── user.go
│       ├── student.go
│       ├── club.go
│       └── event.go
├── migrations/
├── tests/
├── .env
├── .env.example
├── go.mod
└── go.sum
```

Use Goose migrations with sequential, versioned SQL files. Keep migration files as the source of truth for database schema changes.

## 7. Frontend Architecture — Vite + React

### 7.1 Suggested folder structure

```text
frontend/
├── src/
│   ├── components/
│   │   ├── ui/
│   │   ├── layout/
│   │   └── shared/
│   ├── pages/
│   │   ├── auth/
│   │   ├── student/
│   │   ├── coordinator/
│   │   └── admin/
│   ├── features/
│   │   ├── clubs/
│   │   ├── events/
│   │   ├── registrations/
│   │   ├── attendance/
│   │   └── feedback/
│   ├── hooks/
│   ├── services/
│   │   └── api.ts
│   ├── types/
│   ├── context/
│   ├── routes/
│   ├── App.tsx
│   └── main.tsx
├── public/
├── .env
├── package.json
└── vite.config.ts
```

### 7.2 Suggested routes

```text
/login
/register

/student/dashboard
/student/clubs
/student/events
/student/registrations
/student/certificates

/coordinator/dashboard
/coordinator/events
/coordinator/members
/coordinator/attendance

/admin/dashboard
/admin/students
/admin/clubs
/admin/events
/admin/venues
```

Use route guards for user experience, but always verify permissions on the backend. Keep API calls in a shared service layer and use TanStack Query for server state.

## 8. REST API Design

Use a versioned base path: `/api/v1`.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/auth/register` | Create an account |
| POST | `/auth/login` | Log in |
| GET | `/auth/me` | Get current user |
| GET | `/clubs` | List clubs |
| GET | `/clubs/:id` | Get club details |
| POST | `/clubs/:id/join` | Request club membership |
| GET | `/events` | List events |
| POST | `/events` | Create an event |
| GET | `/events/:id` | Get event details |
| POST | `/events/:id/register` | Register for an event |
| DELETE | `/registrations/:id` | Cancel a registration |
| GET | `/events/:id/registrations` | List event registrations |
| POST | `/registrations/:id/attendance` | Mark attendance |
| POST | `/events/:id/feedback` | Submit feedback |
| GET | `/students/:id/certificates` | List student certificates |

Add admin endpoints for managing departments, venues, clubs, users, and event approvals. Add coordinator authorization to event and membership management endpoints.

Use consistent JSON response shapes and appropriate HTTP status codes. Paginate list endpoints rather than returning unbounded result sets.

## 9. Neon PostgreSQL Setup

1. Create a project in [Neon](https://neon.tech/).
2. Create or select the PostgreSQL database, for example `campusconnect`.
3. Copy the connection string from the Neon dashboard.
4. Store it in the backend environment, not in the frontend.
5. Initialize a `pgxpool` connection pool.
6. Run Goose migrations against the Neon database.
7. Seed the database with realistic sample data.

Example backend `.env`:

```env
PORT=8080
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
JWT_SECRET=replace_with_a_long_random_secret
FRONTEND_URL=http://localhost:5173
```

Never commit `.env` files. Commit an `.env.example` containing placeholders only. Never expose `DATABASE_URL` or `JWT_SECRET` through Vite environment variables (including variables prefixed with `VITE_`).

### 9.1 Example pgxpool initialization

```go
package database

import (
    "context"
    "os"

    "github.com/jackc/pgx/v5/pgxpool"
)

func Connect() (*pgxpool.Pool, error) {
    config, err := pgxpool.ParseConfig(os.Getenv("DATABASE_URL"))
    if err != nil {
        return nil, err
    }

    pool, err := pgxpool.NewWithConfig(context.Background(), config)
    if err != nil {
        return nil, err
    }

    if err := pool.Ping(context.Background()); err != nil {
        pool.Close()
        return nil, err
    }

    return pool, nil
}
```

For production, configure pool limits and connection timeouts deliberately. Use the Neon pooled connection string when appropriate for the application's connection pattern and deployment environment.

## 10. SQL Implementation and RDBMS Evaluation

The database must be more than a place to store API data. Prepare a dedicated SQL script and demonstrate each concept directly against PostgreSQL.

### 10.1 Required SQL concepts

| Concept | Project example |
|---|---|
| DDL | Create and alter all tables |
| DML | Insert, update, and delete records |
| Constraints | PK, FK, UNIQUE, CHECK, NOT NULL |
| Joins | Events with club and venue information |
| LEFT JOIN | Events with zero or more registrations |
| GROUP BY | Count registrations per event |
| HAVING | Find events with more than a given number of registrations |
| Subqueries | Find students with above-average registrations |
| Aggregates | Average event feedback rating |
| Views | Upcoming published events |
| Indexes | Optimize event-date and registration lookups |
| Transactions | Safely register a student |
| Trigger | Maintain an audit timestamp or enforce a suitable database-side rule |
| Stored procedure/function | Encapsulate a useful database operation |

### 10.2 Example SQL queries

The examples below assume lowercase table and column names as specified in the schema.

**1. Events with club and venue details**

```sql
SELECT
    e.title,
    c.name AS club,
    v.name AS venue,
    e.event_date
FROM events AS e
JOIN clubs AS c ON c.club_id = e.club_id
JOIN venues AS v ON v.venue_id = e.venue_id;
```

**2. Most popular clubs by approved membership**

```sql
SELECT
    c.name,
    COUNT(cm.membership_id) AS approved_members
FROM clubs AS c
LEFT JOIN club_members AS cm
    ON cm.club_id = c.club_id
   AND cm.status = 'approved'
GROUP BY c.club_id, c.name
ORDER BY approved_members DESC;
```

**3. Events with more than 20 confirmed registrations**

```sql
SELECT
    e.title,
    COUNT(r.registration_id) AS total_registrations
FROM events AS e
JOIN registrations AS r ON r.event_id = e.event_id
WHERE r.status = 'confirmed'
GROUP BY e.event_id, e.title
HAVING COUNT(r.registration_id) > 20;
```

**4. Average feedback rating for each event**

```sql
SELECT
    e.title,
    ROUND(AVG(f.rating), 2) AS average_rating
FROM events AS e
LEFT JOIN feedback AS f ON f.event_id = e.event_id
GROUP BY e.event_id, e.title;
```

**5. Upcoming published events view**

```sql
CREATE VIEW upcoming_events AS
SELECT
    e.event_id,
    e.title,
    e.event_date,
    c.name AS club_name,
    v.name AS venue_name
FROM events AS e
JOIN clubs AS c ON c.club_id = e.club_id
JOIN venues AS v ON v.venue_id = e.venue_id
WHERE e.event_date >= CURRENT_TIMESTAMP
  AND e.status = 'published';
```

The view uses the database's current timestamp when queried. If the project needs a fixed evaluation dataset, seed events with dates relative to the test run.

### 10.3 Registration transaction and concurrency

Registration must not exceed event capacity, even when many students attempt to register simultaneously.

Recommended transaction:

1. Begin a transaction.
2. Lock the target event row using `SELECT ... FOR UPDATE`.
3. Check that the event is published and its registration deadline has not passed.
4. Count confirmed registrations.
5. Check whether capacity remains.
6. Insert the registration.
7. Commit the transaction; roll back on any failure.

The event-row lock serializes capacity checks for registrations to the same event. Also enforce `UNIQUE(student_id, event_id)` to prevent duplicate registrations. Use parameterized SQL throughout.

## 11. Security and Validation

| Area | Requirement |
|---|---|
| Password storage | Hash passwords with bcrypt; never store plaintext |
| Authentication | Validate JWTs on protected routes |
| Authorization | Enforce role permissions in Go middleware/services |
| SQL injection | Use parameterized queries through pgx |
| CORS | Allow only the configured frontend origin |
| Secrets | Keep database credentials and JWT secrets server-side |
| Input validation | Validate request bodies, IDs, and query parameters |
| Database integrity | Use foreign keys and check constraints |
| Transactions | Make multi-step operations atomic |
| Errors | Avoid returning secrets or internal database details to clients |

For browser authentication, choose a deliberate token storage strategy. Prefer secure, HttpOnly, Secure, SameSite cookies when the deployment setup supports them, and implement CSRF protections as appropriate. If using bearer tokens, understand the risks of browser storage and avoid placing long-lived sensitive tokens in local storage.

## 12. Testing Plan

### Backend

- Unit-test service business rules.
- Test handlers with Go `httptest`.
- Test repositories against a PostgreSQL test database.
- Test authentication and role permissions.
- Test duplicate membership and registration constraints.
- Test capacity limits and concurrent registrations.
- Test transaction rollback behavior.

### Frontend

- Test forms and validation.
- Test loading, empty, and error states.
- Test role-based navigation.
- Test registration and cancellation flows.
- Test coordinator attendance workflows.

### Database

- Verify all foreign keys and uniqueness constraints.
- Test CHECK constraints.
- Test joins, aggregates, subqueries, and views.
- Test transaction behavior.
- Verify seed data supports meaningful query results.

Use a separate test database or isolated test schema. Do not run destructive tests against production data.

## 13. Development Roadmap

Complete each phase and verify its deliverables before moving on.

### Phase 1 — Database Design

- Finalize the ER diagram in ERDPlus.
- Convert the ER diagram into a relational schema.
- Define primary keys, foreign keys, and constraints.
- Normalize the schema to 3NF.
- Create the PostgreSQL tables.
- Insert realistic sample data.

**Deliverable:** A working database with all relationships and sample records.

### Phase 2 — Backend Foundation

- Initialize the Go project.
- Configure Chi routing.
- Connect Neon PostgreSQL using pgx.
- Configure Goose migrations.
- Add environment configuration and error handling.
- Create handler, service, and repository layers.

**Deliverable:** A running Go API connected to Neon.

### Phase 3 — Authentication and Authorization

- Implement account registration and login.
- Hash passwords with bcrypt.
- Implement JWT or cookie-based authentication.
- Add role-based authorization.
- Enforce student, coordinator, and administrator permissions.

**Deliverable:** Working and protected authentication flows.

### Phase 4 — Core Backend Functionality

- Department and student management.
- Club management.
- Membership requests and approvals.
- Venue management.
- Event creation and management.
- Event registration and cancellation.

**Deliverable:** Core REST APIs with database-backed workflows.

### Phase 5 — Frontend Development

- Initialize Vite + React + TypeScript.
- Configure Tailwind CSS and routing.
- Build shared components and layouts.
- Build login and registration pages.
- Build student, coordinator, and admin dashboards.
- Integrate APIs using TanStack Query.

**Deliverable:** Functional frontend connected to the backend.

### Phase 6 — Advanced Features

- Attendance management.
- Certificate records and download flow.
- Event feedback.
- Event analytics.
- Safe capacity handling for concurrent registrations.

**Deliverable:** Complete application workflows.

### Phase 7 — RDBMS Evaluation Preparation

- Prepare 20–25 SQL queries.
- Demonstrate joins and subqueries.
- Create views and indexes.
- Implement a stored procedure or function.
- Implement a trigger.
- Demonstrate transactions.
- Test constraints and referential integrity.

**Deliverable:** SQL scripts and a clear database demonstration for evaluation.

### Phase 8 — Testing and Deployment

- Test Go API endpoints.
- Test frontend workflows.
- Test database constraints and concurrency.
- Deploy the frontend and backend.
- Configure the deployed backend to connect to Neon.
- Verify environment variables, CORS, and authentication in production.

**Deliverable:** Deployed CampusConnect application.

## 14. Repository Structure

Keep frontend and backend in separate directories in one repository:

```text
campusconnect/
├── frontend/
│   └── Vite + React application
├── backend/
│   ├── cmd/
│   ├── internal/
│   ├── migrations/
│   └── tests/
├── docs/
│   ├── er-diagram.png
│   ├── relational-schema.pdf
│   ├── sql-queries.sql
│   ├── api-documentation.md
│   └── project-report.md
├── README.md
└── .gitignore
```

## 15. Final Project Deliverables

Target the following for the first complete version:

- Full-stack working web application.
- ER diagram created in ERDPlus.
- Relational schema.
- PostgreSQL database creation and migration scripts.
- Realistic sample data.
- Collection of at least 25 SQL queries.
- Demonstrations of joins, subqueries, aggregates, views, indexes, constraints, transactions, triggers, and stored procedures/functions.
- Go REST API.
- React frontend with three role-based dashboards.
- API documentation.
- Project report and screenshots.
- Deployed frontend and backend connected to Neon.

## 16. Recommended Implementation Order

**Start with the database, not the frontend.**

1. Finalize the ER diagram.
2. Convert the ER diagram into a relational schema.
3. Write PostgreSQL DDL and migration scripts.
4. Populate the database with realistic sample data.
5. Write and test SQL queries directly against PostgreSQL.
6. Implement Go database connections and repositories.
7. Implement services and REST APIs.
8. Build the React frontend.
9. Integrate and test the complete application.
10. Deploy and prepare the project report.

This order keeps the RDBMS design at the center of the project rather than treating the database as an afterthought.

## 17. Phase 1 — First Tasks

Begin by finalizing the database design. Work through these topics before implementing the backend:

1. ER model, entities, attributes, and cardinalities.
2. Mapping ER diagrams to relational schemas.
3. Primary keys, foreign keys, candidate keys, and constraints.
4. Functional dependencies.
5. 1NF, 2NF, and 3NF.
6. PostgreSQL data types and constraints.
7. Design and create the 11 tables.
8. Insert sample data and verify relationships.

**Phase 1 exit criteria:** The ER diagram, relational schema, migrations, constraints, and sample data are complete and tested in Neon. Only then move on to the Go backend.
