package tests

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestEventLifecycleCapacityAttendanceAndCertificates(t *testing.T) {
	resetSeed(t)

	coordinator := newClient(t)
	coordinator.login("priya@campusconnect.test", "Coordinator123!")
	admin := newClient(t)
	admin.login("admin@campusconnect.test", "Admin123!")

	status, payload := coordinator.get("/api/v1/me/coordinated-clubs")
	expectStatus(t, status, http.StatusOK, payload)
	clubs := decodeData[[]map[string]any](t, payload)
	var codingClubID int64
	for _, club := range clubs {
		if club["name"] == "Coding Club" {
			codingClubID = int64(club["clubId"].(float64))
		}
	}
	if codingClubID == 0 {
		t.Fatalf("Priya should coordinate Coding Club: %s", payload)
	}

	status, payload = coordinator.get("/api/v1/venues")
	expectStatus(t, status, http.StatusOK, payload)
	venues := decodeData[[]map[string]any](t, payload)
	var venueID int64
	for _, venue := range venues {
		if venue["name"] == "Innovation Lab" {
			venueID = int64(venue["venueId"].(float64))
		}
	}
	if venueID == 0 {
		t.Fatalf("expected Innovation Lab venue: %s", payload)
	}

	title := fmt.Sprintf("Integration Capacity Test %d", time.Now().UnixNano())
	eventDate := time.Now().Add(72 * time.Hour).UTC().Format(time.RFC3339)
	deadline := time.Now().Add(48 * time.Hour).UTC().Format(time.RFC3339)
	status, payload = coordinator.post("/api/v1/events", map[string]any{
		"clubId":               codingClubID,
		"venueId":              venueID,
		"title":                title,
		"description":          "A tiny event used to exercise the capacity transaction.",
		"eventDate":            eventDate,
		"registrationDeadline": deadline,
		"capacity":             2,
	})
	expectStatus(t, status, http.StatusCreated, payload)
	created := decodeData[map[string]any](t, payload)
	eventID := int64(created["eventId"].(float64))
	if created["status"] != "pending" {
		t.Fatalf("new events must await approval: %s", payload)
	}

	anonymous := newClient(t)
	status, payload = anonymous.get("/api/v1/events/" + itoa(eventID))
	expectStatus(t, status, http.StatusNotFound, payload)

	status, payload = coordinator.get("/api/v1/coordinator/events?status=pending&upcoming=false&pageSize=50")
	expectStatus(t, status, http.StatusOK, payload)
	managed := decodeData[[]map[string]any](t, payload)
	found := false
	for _, event := range managed {
		if int64(event["eventId"].(float64)) == eventID {
			found = true
		}
	}
	if !found {
		t.Fatalf("pending event should appear in managed list: %s", payload)
	}

	status, payload = admin.patch("/api/v1/admin/events/"+itoa(eventID)+"/status", map[string]any{"status": "published"})
	expectStatus(t, status, http.StatusOK, payload)
	published := decodeData[map[string]any](t, payload)
	if published["status"] != "published" {
		t.Fatalf("admin approval failed: %s", payload)
	}

	status, payload = anonymous.get("/api/v1/events/" + itoa(eventID))
	expectStatus(t, status, http.StatusOK, payload)

	students := make([]*apiClient, 3)
	for index := range students {
		students[index] = newClient(t)
		students[index].login(fmt.Sprintf("student%02d@campusconnect.test", index+1), "Password123!")
	}

	registrationIDs := make([]int64, 0, 3)
	for index, student := range students[:2] {
		status, payload = student.post("/api/v1/events/"+itoa(eventID)+"/register", nil)
		if status != http.StatusCreated {
			t.Fatalf("student %d should register: status %d body %s", index+1, status, payload)
		}
		registration := decodeData[map[string]any](t, payload)
		registrationIDs = append(registrationIDs, int64(registration["registrationId"].(float64)))
	}

	status, payload = students[0].post("/api/v1/events/"+itoa(eventID)+"/register", nil)
	expectStatus(t, status, http.StatusConflict, payload)

	status, payload = students[2].post("/api/v1/events/"+itoa(eventID)+"/register", nil)
	expectStatus(t, status, http.StatusConflict, payload)
	if !containsAny(string(payload), "capacity", "full", "seats") {
		t.Fatalf("full-event conflict should be readable: %s", payload)
	}

	status, payload = coordinator.get("/api/v1/events/" + itoa(eventID) + "/stats")
	expectStatus(t, status, http.StatusOK, payload)
	stats := decodeData[map[string]any](t, payload)
	if int(stats["confirmedRegistrations"].(float64)) != 2 {
		t.Fatalf("expected two confirmed registrations: %s", payload)
	}

	// Cancelling releases a seat and allows the next student through.
	status, payload = students[0].delete("/api/v1/registrations/" + itoa(registrationIDs[0]))
	expectStatus(t, status, http.StatusNoContent, payload)

	status, payload = students[2].post("/api/v1/events/"+itoa(eventID)+"/register", nil)
	expectStatus(t, status, http.StatusCreated, payload)
	third := decodeData[map[string]any](t, payload)
	thirdRegistrationID := int64(third["registrationId"].(float64))

	// Attendance on confirmed registrations issues certificates via trigger.
	status, payload = coordinator.post("/api/v1/events/"+itoa(eventID)+"/attendance", map[string]any{
		"entries": []map[string]any{
			{"registrationId": registrationIDs[1], "status": "present"},
			{"registrationId": thirdRegistrationID, "status": "absent"},
		},
	})
	expectStatus(t, status, http.StatusOK, payload)
	attendance := decodeData[[]map[string]any](t, payload)
	if len(attendance) != 2 {
		t.Fatalf("expected two attendance rows: %s", payload)
	}

	// The attendance trigger issues certificates for present attendees. Remove
	// one to exercise the coordinator's idempotent backfill endpoint too.
	if _, err := testPool.Exec(context.Background(),
		`DELETE FROM certificates WHERE registration_id = $1`, registrationIDs[1],
	); err != nil {
		t.Fatalf("clear certificate: %v", err)
	}
	status, payload = coordinator.post("/api/v1/events/"+itoa(eventID)+"/certificates", nil)
	expectStatus(t, status, http.StatusOK, payload)
	issued := decodeData[map[string]any](t, payload)
	if int(issued["issued"].(float64)) != 1 {
		t.Fatalf("the present attendee should receive a certificate: %s", payload)
	}
	status, payload = coordinator.post("/api/v1/events/"+itoa(eventID)+"/certificates", nil)
	expectStatus(t, status, http.StatusOK, payload)
	issuedAgain := decodeData[map[string]any](t, payload)
	if int(issuedAgain["issued"].(float64)) != 0 {
		t.Fatalf("certificate issuance should be idempotent: %s", payload)
	}

	status, payload = students[1].get("/api/v1/me/certificates")
	expectStatus(t, status, http.StatusOK, payload)
	certificates := decodeData[[]map[string]any](t, payload)
	foundCertificate := false
	for _, certificate := range certificates {
		if int64(certificate["registrationId"].(float64)) == registrationIDs[1] {
			foundCertificate = true
			if code, _ := certificate["certificateCode"].(string); code == "" {
				t.Fatalf("certificate code missing: %v", certificate)
			}
		}
	}
	if !foundCertificate {
		t.Fatalf("present student should see the issued certificate: %s", payload)
	}

	status, payload = coordinator.get("/api/v1/events/" + itoa(eventID) + "/stats")
	expectStatus(t, status, http.StatusOK, payload)
	stats = decodeData[map[string]any](t, payload)
	if int(stats["presentCount"].(float64)) != 1 || int(stats["absentCount"].(float64)) != 1 {
		t.Fatalf("unexpected attendance stats: %s", payload)
	}

	// Event deletion is blocked while registrations exist.
	status, payload = coordinator.delete("/api/v1/events/" + itoa(eventID))
	expectStatus(t, status, http.StatusConflict, payload)
}

func TestFeedbackRules(t *testing.T) {
	resetSeed(t)
	ctx := context.Background()

	var eventID int64
	var studentEmail string
	err := testPool.QueryRow(ctx, `
		SELECT e.event_id, u.email
		FROM registrations r
		JOIN events e ON e.event_id = r.event_id
		JOIN clubs c ON c.club_id = e.club_id
		JOIN students s ON s.student_id = r.student_id
		JOIN users u ON u.user_id = s.user_id
		LEFT JOIN feedback f ON f.event_id = e.event_id AND f.student_id = r.student_id
		WHERE c.name = 'Coding Club'
		  AND e.status = 'completed'
		  AND e.event_date < CURRENT_TIMESTAMP
		  AND r.status = 'confirmed'
		  AND u.role = 'student'
		  AND f.feedback_id IS NULL
		LIMIT 1
	`).Scan(&eventID, &studentEmail)
	if err != nil {
		t.Fatalf("find feedback candidate: %v", err)
	}

	student := newClient(t)
	student.login(studentEmail, "Password123!")
	status, payload := student.post("/api/v1/events/"+itoa(eventID)+"/feedback", map[string]any{
		"rating":   5,
		"comments": "Great speakers and a well-paced session.",
	})
	expectStatus(t, status, http.StatusCreated, payload)
	feedback := decodeData[map[string]any](t, payload)
	if int(feedback["rating"].(float64)) != 5 {
		t.Fatalf("unexpected feedback: %s", payload)
	}

	status, payload = student.post("/api/v1/events/"+itoa(eventID)+"/feedback", map[string]any{
		"rating":   4,
		"comments": "Duplicate feedback should be rejected.",
	})
	expectStatus(t, status, http.StatusConflict, payload)

	status, payload = student.get("/api/v1/events/" + itoa(eventID) + "/feedback")
	expectStatus(t, status, http.StatusOK, payload)
	ownFeedback := decodeData[[]map[string]any](t, payload)
	if len(ownFeedback) != 1 {
		t.Fatalf("student should only see their own feedback: %s", payload)
	}

	coordinator := newClient(t)
	coordinator.login("priya@campusconnect.test", "Coordinator123!")
	status, payload = coordinator.get("/api/v1/events/" + itoa(eventID) + "/feedback")
	expectStatus(t, status, http.StatusOK, payload)
	allFeedback := decodeData[[]map[string]any](t, payload)
	var expectedFeedback int
	if err := testPool.QueryRow(ctx,
		`SELECT COUNT(*) FROM feedback WHERE event_id = $1`, eventID,
	).Scan(&expectedFeedback); err != nil {
		t.Fatalf("count feedback: %v", err)
	}
	if len(allFeedback) != expectedFeedback || len(allFeedback) < 2 {
		t.Fatalf("coordinator should see all event feedback: got %d want %d (%s)", len(allFeedback), expectedFeedback, payload)
	}

	// A student who did not attend cannot submit feedback.
	var outsiderEmail string
	if err := testPool.QueryRow(ctx, `
		SELECT u.email
		FROM students s
		JOIN users u ON u.user_id = s.user_id
		WHERE u.role = 'student'
		  AND NOT EXISTS (
			SELECT 1 FROM registrations r
			WHERE r.student_id = s.student_id AND r.event_id = $1
		  )
		ORDER BY s.student_id
		LIMIT 1
	`, eventID).Scan(&outsiderEmail); err != nil {
		t.Fatalf("find outsider: %v", err)
	}
	outsider := newClient(t)
	outsider.login(outsiderEmail, "Password123!")
	status, payload = outsider.post("/api/v1/events/"+itoa(eventID)+"/feedback", map[string]any{
		"rating":   3,
		"comments": "Not eligible.",
	})
	if status == http.StatusCreated {
		t.Fatalf("feedback should require a confirmed registration: %s", payload)
	}
}

func containsAny(value string, needles ...string) bool {
	lower := strings.ToLower(value)
	for _, needle := range needles {
		if strings.Contains(lower, strings.ToLower(needle)) {
			return true
		}
	}
	return false
}
