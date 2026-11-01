-- CampusConnect demo seed data.
-- Run after migrations:  psql "$DATABASE_URL" -f seeds/seed.sql
-- Every demo account password is documented in README.md.
-- Dates are relative to CURRENT_DATE so the demo always has upcoming events.

BEGIN;

TRUNCATE TABLE certificates, feedback, attendance, registrations, events, venues,
    club_members, clubs, students, users, departments
    RESTART IDENTITY CASCADE;

INSERT INTO departments (name, code) VALUES
    ('Computer Science & Engineering', 'CSE'),
    ('Electronics & Communication', 'ECE'),
    ('Mechanical Engineering', 'MECH'),
    ('Business Administration', 'BBA'),
    ('Design', 'DSGN');

-- bcrypt cost 12. admin: Admin123!  coordinators: Coordinator123!  students: Password123!
INSERT INTO users (email, password_hash, role) VALUES
    ('admin@campusconnect.test', '$2a$12$fuCG42N8Klcuobskpu/6peqLUy3pS0H1YjfyZIt9Z06BQoorOgdCO', 'admin'),
    ('priya@campusconnect.test', '$2a$12$ZULL0HG8oCzP.Fy62LD1cuNAgjfZK2Gcvmg0gwmYIlgp1fKgWOABm', 'coordinator'),
    ('arjun@campusconnect.test', '$2a$12$ZULL0HG8oCzP.Fy62LD1cuNAgjfZK2Gcvmg0gwmYIlgp1fKgWOABm', 'coordinator'),
    ('sana@campusconnect.test',  '$2a$12$ZULL0HG8oCzP.Fy62LD1cuNAgjfZK2Gcvmg0gwmYIlgp1fKgWOABm', 'coordinator'),
    ('rohan@campusconnect.test', '$2a$12$ZULL0HG8oCzP.Fy62LD1cuNAgjfZK2Gcvmg0gwmYIlgp1fKgWOABm', 'coordinator'),
    ('meera@campusconnect.test', '$2a$12$ZULL0HG8oCzP.Fy62LD1cuNAgjfZK2Gcvmg0gwmYIlgp1fKgWOABm', 'coordinator'),
    ('kabir@campusconnect.test', '$2a$12$ZULL0HG8oCzP.Fy62LD1cuNAgjfZK2Gcvmg0gwmYIlgp1fKgWOABm', 'coordinator'),
    ('ananya@campusconnect.test','$2a$12$ZULL0HG8oCzP.Fy62LD1cuNAgjfZK2Gcvmg0gwmYIlgp1fKgWOABm', 'coordinator');

INSERT INTO users (email, password_hash, role)
SELECT
    'student' || lpad(n::text, 2, '0') || '@campusconnect.test',
    '$2a$12$xiRYrnxfftNvjA65rB2aIebUJBdNuGSX5uu4mXygtRBsIhMuqekA2',
    'student'
FROM generate_series(1, 24) AS n;

WITH coordinator_data (email, full_name, enrollment, department) AS (
    VALUES
        ('priya@campusconnect.test',  'Priya Nair',   'CSE2024001', 'CSE'),
        ('arjun@campusconnect.test',  'Arjun Mehta',  'ECE2024002', 'ECE'),
        ('sana@campusconnect.test',   'Sana Khan',    'BBA2024003', 'BBA'),
        ('rohan@campusconnect.test',  'Rohan Iyer',   'DSGN2024004','DSGN'),
        ('meera@campusconnect.test',  'Meera Joshi',  'MECH2024005','MECH'),
        ('kabir@campusconnect.test',  'Kabir Rao',    'CSE2024006', 'CSE'),
        ('ananya@campusconnect.test', 'Ananya Das',   'ECE2024007', 'ECE')
)
INSERT INTO students (user_id, department_id, full_name, enrollment_number)
SELECT u.user_id, d.department_id, cd.full_name, cd.enrollment
FROM coordinator_data cd
JOIN users u ON u.email = cd.email
JOIN departments d ON d.code = cd.department;

WITH generated_names AS (
    SELECT n, (ARRAY[
        'Aarav Sharma', 'Isha Patel', 'Vihaan Reddy', 'Diya Kapoor', 'Advait Singh',
        'Anika Verma', 'Reyansh Gupta', 'Myra Bhatt', 'Aryan Malhotra', 'Saanvi Desai',
        'Dhruv Kulkarni', 'Aisha Siddiqui', 'Neel Shah', 'Riya Chatterjee', 'Ved Joshi',
        'Naina Pillai', 'Kunal Saxena', 'Tara Menon', 'Yash Agarwal', 'Zoya Mirza',
        'Ishaan Bose', 'Pooja Rane', 'Dev Thakur', 'Nisha Kamath'
    ])[n] AS full_name,
    (ARRAY['CSE', 'ECE', 'MECH', 'BBA', 'DSGN'])[((n - 1) % 5) + 1] AS dept_code
    FROM generate_series(1, 24) AS n
)
INSERT INTO students (user_id, department_id, full_name, enrollment_number)
SELECT
    u.user_id,
    d.department_id,
    g.full_name,
    g.dept_code || '2025' || lpad(g.n::text, 3, '0')
FROM generated_names g
JOIN users u ON u.email = 'student' || lpad(g.n::text, 2, '0') || '@campusconnect.test'
JOIN departments d ON d.code = g.dept_code;

INSERT INTO clubs (name, description, status, created_at) VALUES
    ('Coding Club', 'Competitive programming, open-source and hack nights for builders across campus.', 'approved', CURRENT_TIMESTAMP - INTERVAL '400 days'),
    ('Robotics Club', 'Hardware tinkering, robo-wars and autonomous systems workshops.', 'approved', CURRENT_TIMESTAMP - INTERVAL '380 days'),
    ('Entrepreneurship Cell', 'Pitch practice, founder chats and startup mentorship for student ventures.', 'approved', CURRENT_TIMESTAMP - INTERVAL '350 days'),
    ('Design Collective', 'Product, graphic and spatial design critiques with weekly studio sessions.', 'approved', CURRENT_TIMESTAMP - INTERVAL '320 days'),
    ('Sports Club', 'Inter-department leagues, fitness sessions and the annual sports meet.', 'approved', CURRENT_TIMESTAMP - INTERVAL '300 days'),
    ('Campus Life Society', 'Community events, mixers and student wellbeing initiatives.', 'approved', CURRENT_TIMESTAMP - INTERVAL '280 days'),
    ('Music Club', 'Jam sessions, acoustic nights and the campus music festival.', 'approved', CURRENT_TIMESTAMP - INTERVAL '250 days'),
    ('Debate Society', 'Parliamentary debate training and inter-college tournaments.', 'pending', CURRENT_TIMESTAMP - INTERVAL '12 days');

INSERT INTO venues (name, capacity, location) VALUES
    ('Innovation Lab', 120, 'Engineering Block, Ground Floor'),
    ('Main Auditorium', 300, 'Central Campus'),
    ('Seminar Hall A', 150, 'Academic Block A, 2nd Floor'),
    ('Seminar Hall B', 100, 'Academic Block B, 1st Floor'),
    ('Design Studio', 60, 'Design Block, Studio 3'),
    ('Amphitheatre', 250, 'Central Lawn'),
    ('Sports Complex', 500, 'North Campus'),
    ('Library Conference Room', 40, 'Library, 1st Floor');

-- Approved coordinator memberships.
WITH coordinators (email, club_name) AS (
    VALUES
        ('priya@campusconnect.test',  'Coding Club'),
        ('arjun@campusconnect.test',  'Robotics Club'),
        ('sana@campusconnect.test',   'Entrepreneurship Cell'),
        ('rohan@campusconnect.test',  'Design Collective'),
        ('meera@campusconnect.test',  'Sports Club'),
        ('kabir@campusconnect.test',  'Campus Life Society'),
        ('ananya@campusconnect.test', 'Music Club')
)
INSERT INTO club_members (student_id, club_id, role, status, requested_at, decided_at, joined_at, decided_by)
SELECT s.student_id, c.club_id, 'coordinator', 'approved',
       CURRENT_TIMESTAMP - INTERVAL '200 days', CURRENT_TIMESTAMP - INTERVAL '199 days',
       CURRENT_TIMESTAMP - INTERVAL '199 days',
       (SELECT user_id FROM users WHERE email = 'admin@campusconnect.test')
FROM coordinators co
JOIN students s ON s.full_name = CASE co.email
    WHEN 'priya@campusconnect.test' THEN 'Priya Nair'
    WHEN 'arjun@campusconnect.test' THEN 'Arjun Mehta'
    WHEN 'sana@campusconnect.test' THEN 'Sana Khan'
    WHEN 'rohan@campusconnect.test' THEN 'Rohan Iyer'
    WHEN 'meera@campusconnect.test' THEN 'Meera Joshi'
    WHEN 'kabir@campusconnect.test' THEN 'Kabir Rao'
    ELSE 'Ananya Das' END
JOIN clubs c ON c.name = co.club_name;

-- Regular approved members: a rotating slice of the student body per club.
WITH candidates AS (
    SELECT
        s.student_id,
        c.club_id,
        row_number() OVER (PARTITION BY c.club_id ORDER BY s.student_id) AS rn
    FROM students s
    CROSS JOIN clubs c
    WHERE c.status = 'approved'
      AND NOT EXISTS (
          SELECT 1 FROM club_members cm
          WHERE cm.student_id = s.student_id AND cm.club_id = c.club_id
      )
)
INSERT INTO club_members (student_id, club_id, role, status, requested_at, decided_at, joined_at, decided_by)
SELECT
    s.student_id, c.club_id, 'member', 'approved',
    CURRENT_TIMESTAMP - (60 + (s.student_id % 40)) * INTERVAL '1 day',
    CURRENT_TIMESTAMP - (55 + (s.student_id % 40)) * INTERVAL '1 day',
    CURRENT_TIMESTAMP - (55 + (s.student_id % 40)) * INTERVAL '1 day',
    (SELECT user_id FROM users WHERE email = 'admin@campusconnect.test')
FROM candidates c
JOIN students s ON s.student_id = c.student_id
WHERE c.rn <= 7 + (c.club_id % 4);

-- Pending membership requests for coordinators to review.
WITH candidates AS (
    SELECT
        s.student_id,
        c.club_id,
        row_number() OVER (PARTITION BY c.club_id ORDER BY s.student_id DESC) AS rn
    FROM students s
    CROSS JOIN clubs c
    WHERE c.status = 'approved'
      AND NOT EXISTS (
          SELECT 1 FROM club_members cm
          WHERE cm.student_id = s.student_id AND cm.club_id = c.club_id
      )
)
INSERT INTO club_members (student_id, club_id, role, status, requested_at)
SELECT s.student_id, c.club_id, 'member', 'pending',
       CURRENT_TIMESTAMP - (2 + (s.student_id % 5)) * INTERVAL '1 day'
FROM candidates c
JOIN students s ON s.student_id = c.student_id
WHERE c.rn <= 2;

-- Events: completed (past), published (upcoming) and pending approval.
INSERT INTO events (club_id, venue_id, created_by, title, description, event_date, registration_deadline, capacity, status)
SELECT c.club_id, v.venue_id, u.user_id, e.title, e.description, e.event_date, e.registration_deadline, e.capacity, e.status
FROM (
    VALUES
        ('Coding Club', 'Innovation Lab', 'Hack the Campus 2026', 'A 24-hour build sprint with mentors from industry. Teams of up to four ship a working prototype.', CURRENT_DATE - 21 + TIME '09:00', CURRENT_DATE - 24 + TIME '23:59', 60, 'completed'),
        ('Robotics Club', 'Main Auditorium', 'Robotics Expo', 'Student-built robots, autonomous rovers and a live arena demonstration.', CURRENT_DATE - 14 + TIME '11:00', CURRENT_DATE - 17 + TIME '23:59', 80, 'completed'),
        ('Entrepreneurship Cell', 'Seminar Hall A', 'Startup Pitch Night', 'Eight finalist teams pitch to a panel of founders and investors.', CURRENT_DATE - 7 + TIME '18:00', CURRENT_DATE - 10 + TIME '23:59', 50, 'completed'),
        ('Design Collective', 'Design Studio', 'Design Sprint Workshop', 'Hands-on service design sprint from research to prototype.', CURRENT_DATE - 30 + TIME '14:00', CURRENT_DATE - 33 + TIME '23:59', 40, 'completed'),
        ('Sports Club', 'Sports Complex', 'Annual Sports Meet', 'Track, field and team sports finals across all departments.', CURRENT_DATE - 45 + TIME '08:00', CURRENT_DATE - 50 + TIME '23:59', 200, 'completed'),
        ('Coding Club', 'Innovation Lab', 'CodeSprint 2026', 'A timed algorithmic contest with individual and team tracks. Prizes for the top three.', CURRENT_DATE + 5 + TIME '10:00', CURRENT_DATE + 3 + TIME '23:59', 60, 'published'),
        ('Coding Club', 'Seminar Hall A', 'AI & Ethics Panel', 'Faculty and industry practitioners discuss responsible AI deployment.', CURRENT_DATE + 10 + TIME '17:00', CURRENT_DATE + 8 + TIME '23:59', 50, 'published'),
        ('Robotics Club', 'Main Auditorium', 'Robo Wars', 'Combat robotics showcase with a live knockout bracket.', CURRENT_DATE + 14 + TIME '16:00', CURRENT_DATE + 12 + TIME '23:59', 80, 'published'),
        ('Entrepreneurship Cell', 'Seminar Hall B', 'Founders Fireside Chat', 'An informal conversation with alumni founders about building in public.', CURRENT_DATE + 18 + TIME '18:30', CURRENT_DATE + 16 + TIME '23:59', 60, 'published'),
        ('Design Collective', 'Design Studio', 'Portfolio Review Night', 'Bring your portfolio for one-to-one critique with senior designers.', CURRENT_DATE + 21 + TIME '17:00', CURRENT_DATE + 19 + TIME '23:59', 40, 'published'),
        ('Campus Life Society', 'Amphitheatre', 'Freshman Mixer', 'Music, food trucks and club stalls to welcome the incoming batch.', CURRENT_DATE + 7 + TIME '17:30', CURRENT_DATE + 5 + TIME '23:59', 120, 'published'),
        ('Coding Club', 'Innovation Lab', 'Hack Night: Open Source', 'Find a good-first-issue, pair with a maintainer and ship your first pull request.', CURRENT_DATE + 25 + TIME '18:00', CURRENT_DATE + 23 + TIME '23:59', 45, 'published'),
        ('Coding Club', 'Library Conference Room', 'Cloud Workshop', 'Hands-on introduction to managed Postgres and serverless deployment.', CURRENT_DATE + 30 + TIME '15:00', CURRENT_DATE + 28 + TIME '23:59', 35, 'pending'),
        ('Design Collective', 'Amphitheatre', 'Photography Walk', 'Golden-hour photo walk across campus with peer critique afterwards.', CURRENT_DATE + 12 + TIME '16:30', CURRENT_DATE + 10 + TIME '23:59', 30, 'pending')
) AS e(club_name, venue_name, title, description, event_date, registration_deadline, capacity, status)
JOIN clubs c ON c.name = e.club_name
JOIN venues v ON v.name = e.venue_name
JOIN users u ON u.email = 'admin@campusconnect.test';

-- Registrations. Distinct student offsets keep the unique(student,event) rule.
WITH plan (event_title, registered_count, student_offset, reg_status) AS (
    VALUES
        ('Hack the Campus 2026', 22, 1, 'confirmed'),
        ('Robotics Expo', 15, 4, 'confirmed'),
        ('Startup Pitch Night', 12, 2, 'confirmed'),
        ('Design Sprint Workshop', 10, 7, 'confirmed'),
        ('Annual Sports Meet', 18, 3, 'confirmed'),
        ('CodeSprint 2026', 14, 1, 'confirmed'),
        ('AI & Ethics Panel', 8, 6, 'confirmed'),
        ('Robo Wars', 11, 2, 'confirmed'),
        ('Founders Fireside Chat', 6, 9, 'confirmed'),
        ('Portfolio Review Night', 9, 5, 'confirmed'),
        ('Freshman Mixer', 20, 2, 'confirmed'),
        ('Hack Night: Open Source', 5, 12, 'confirmed')
),
ranked AS (
    SELECT student_id, row_number() OVER (ORDER BY student_id) AS rn FROM students
)
INSERT INTO registrations (student_id, event_id, registered_at, status)
SELECT r.student_id, e.event_id,
       e.created_at + INTERVAL '1 day',
       p.reg_status
FROM plan p
JOIN events e ON e.title = p.event_title
JOIN ranked r ON r.rn BETWEEN p.student_offset AND p.student_offset + p.registered_count - 1
ON CONFLICT (student_id, event_id) DO NOTHING;

-- A few cancellations to demonstrate status filtering and seat release.
WITH cancelled (event_title, student_offset) AS (
    VALUES ('CodeSprint 2026', 28), ('Freshman Mixer', 29), ('Robo Wars', 30)
)
INSERT INTO registrations (student_id, event_id, registered_at, status, cancelled_at)
SELECT s.student_id, e.event_id, e.created_at + INTERVAL '2 days', 'cancelled', CURRENT_TIMESTAMP - INTERVAL '1 day'
FROM cancelled c
JOIN events e ON e.title = c.event_title
JOIN (SELECT student_id, row_number() OVER (ORDER BY student_id) AS rn FROM students) s
  ON s.rn = c.student_offset
ON CONFLICT (student_id, event_id) DO NOTHING;

-- Attendance for completed events. Present attendance auto-issues certificates.
INSERT INTO attendance (registration_id, attendance_status, marked_at, marked_by)
SELECT
    r.registration_id,
    CASE WHEN (r.student_id + r.event_id) % 8 = 0 THEN 'absent' ELSE 'present' END,
    e.event_date + INTERVAL '2 hours',
    (SELECT user_id FROM users WHERE email = 'admin@campusconnect.test')
FROM registrations r
JOIN events e ON e.event_id = r.event_id
WHERE e.status = 'completed'
  AND e.event_date < CURRENT_TIMESTAMP
  AND r.status = 'confirmed'
ON CONFLICT (registration_id) DO NOTHING;

-- Feedback from students who actually attended (every other attendee).
INSERT INTO feedback (student_id, event_id, rating, comments, created_at)
SELECT
    r.student_id,
    r.event_id,
    (3 + (r.student_id % 3))::SMALLINT,
    CASE (3 + (r.student_id % 3))
        WHEN 5 THEN 'Excellent session, well organised and genuinely useful.'
        WHEN 4 THEN 'Really enjoyed it. Would attend the next edition.'
        ELSE 'Good content, but the session could have been shorter.'
    END,
    e.event_date + INTERVAL '1 day'
FROM registrations r
JOIN attendance a ON a.registration_id = r.registration_id
JOIN events e ON e.event_id = r.event_id
WHERE a.attendance_status = 'present'
  AND r.student_id % 2 = 0
ON CONFLICT (student_id, event_id) DO NOTHING;

COMMIT;

-- Quick verification queries.
SELECT 'departments' AS entity, COUNT(*) FROM departments
UNION ALL SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'students', COUNT(*) FROM students
UNION ALL SELECT 'clubs', COUNT(*) FROM clubs
UNION ALL SELECT 'club_members', COUNT(*) FROM club_members
UNION ALL SELECT 'venues', COUNT(*) FROM venues
UNION ALL SELECT 'events', COUNT(*) FROM events
UNION ALL SELECT 'registrations', COUNT(*) FROM registrations
UNION ALL SELECT 'attendance', COUNT(*) FROM attendance
UNION ALL SELECT 'feedback', COUNT(*) FROM feedback
UNION ALL SELECT 'certificates', COUNT(*) FROM certificates;
