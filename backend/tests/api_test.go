package tests

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

func TestAuthRBACAndCSRF(t *testing.T) {
	resetSeed(t)

	anonymous := newClient(t)
	status, payload := anonymous.get("/api/v1/auth/me")
	expectStatus(t, status, http.StatusUnauthorized, payload)

	student := newClient(t)
	user := student.login("student01@campusconnect.test", "Password123!")
	if user["role"] != "student" {
		t.Fatalf("expected student role, got %v", user["role"])
	}

	status, payload = student.get("/api/v1/auth/me")
	expectStatus(t, status, http.StatusOK, payload)
	me := decodeData[map[string]any](t, payload)
	if me["email"] != "student01@campusconnect.test" {
		t.Fatalf("unexpected session user: %s", payload)
	}

	status, payload = student.get("/api/v1/admin/dashboard")
	expectStatus(t, status, http.StatusForbidden, payload)

	// Cookie-authenticated mutations require the double-submit CSRF header.
	status, payload = student.do(http.MethodPost, "/api/v1/clubs/1/join", nil, map[string]string{
		"X-CSRF-Token": "definitely-not-the-cookie-token",
	})
	expectStatus(t, status, http.StatusForbidden, payload)
	expectErrorCode(t, payload, "csrf_failed")

	admin := newClient(t)
	adminUser := admin.login("admin@campusconnect.test", "Admin123!")
	if adminUser["role"] != "admin" {
		t.Fatalf("expected admin role, got %v", adminUser["role"])
	}
	status, payload = admin.get("/api/v1/admin/dashboard")
	expectStatus(t, status, http.StatusOK, payload)
	dashboard := decodeData[map[string]any](t, payload)
	if _, ok := dashboard["stats"]; !ok {
		t.Fatalf("admin dashboard missing stats: %s", payload)
	}

	coordinator := newClient(t)
	coordinator.login("priya@campusconnect.test", "Coordinator123!")
	status, payload = coordinator.get("/api/v1/coordinator/dashboard")
	expectStatus(t, status, http.StatusOK, payload)
	status, payload = coordinator.get("/api/v1/admin/users")
	expectStatus(t, status, http.StatusForbidden, payload)

	// Logging out clears the session cookie.
	status, payload = student.post("/api/v1/auth/logout", nil)
	expectStatus(t, status, http.StatusNoContent, payload)
	status, payload = student.get("/api/v1/auth/me")
	expectStatus(t, status, http.StatusUnauthorized, payload)
}

func TestPublicDiscoveryAndManagedEventScopes(t *testing.T) {
	resetSeed(t)

	anonymous := newClient(t)
	status, payload := anonymous.get("/api/v1/departments")
	expectStatus(t, status, http.StatusOK, payload)
	departments := decodeData[[]map[string]any](t, payload)
	if len(departments) < 5 {
		t.Fatalf("expected seeded departments, got %d", len(departments))
	}

	status, payload = anonymous.get("/api/v1/clubs?page=1&pageSize=5")
	expectStatus(t, status, http.StatusOK, payload)
	clubs, meta := decodeDataWithMeta[[]map[string]any](t, payload)
	if len(clubs) == 0 || meta["total"].(float64) == 0 {
		t.Fatalf("expected public clubs: %s", payload)
	}
	for _, club := range clubs {
		if club["status"] != "approved" {
			t.Fatalf("public club list leaked non-approved club: %v", club)
		}
	}

	status, payload = anonymous.get("/api/v1/events?pageSize=100")
	expectStatus(t, status, http.StatusOK, payload)
	events := decodeData[[]map[string]any](t, payload)
	if len(events) == 0 {
		t.Fatalf("expected public events: %s", payload)
	}
	for _, event := range events {
		if event["status"] != "published" {
			t.Fatalf("public event list leaked status %v", event["status"])
		}
		if event["clubName"] == "" || event["venueName"] == "" {
			t.Fatalf("event missing joined display fields: %v", event)
		}
	}

	var pendingEventID int64
	if err := testPool.QueryRow(context.Background(),
		`SELECT event_id FROM events WHERE title = 'Cloud Workshop'`,
	).Scan(&pendingEventID); err != nil {
		t.Fatalf("find pending event: %v", err)
	}
	status, payload = anonymous.get("/api/v1/events/" + itoa(pendingEventID))
	expectStatus(t, status, http.StatusNotFound, payload)

	coordinator := newClient(t)
	coordinator.login("priya@campusconnect.test", "Coordinator123!")
	status, payload = coordinator.get("/api/v1/coordinator/events?status=pending&upcoming=false")
	expectStatus(t, status, http.StatusOK, payload)
	managed := decodeData[[]map[string]any](t, payload)
	foundPending := false
	for _, event := range managed {
		if event["title"] == "Cloud Workshop" {
			foundPending = true
		}
	}
	if !foundPending {
		t.Fatalf("coordinator managed list should include pending events: %s", payload)
	}

	status, payload = coordinator.get("/api/v1/coordinator/events/" + itoa(pendingEventID))
	expectStatus(t, status, http.StatusOK, payload)
	pending := decodeData[map[string]any](t, payload)
	if pending["status"] != "pending" {
		t.Fatalf("unexpected managed event: %s", payload)
	}

	status, payload = coordinator.get("/api/v1/events?scope=managed&upcoming=false&pageSize=100")
	expectStatus(t, status, http.StatusOK, payload)
	scoped := decodeData[[]map[string]any](t, payload)
	statuses := make(map[string]bool)
	for _, event := range scoped {
		statuses[event["status"].(string)] = true
	}
	if !statuses["pending"] && !statuses["completed"] {
		t.Fatalf("scope=managed should expose non-public events: %s", payload)
	}

	admin := newClient(t)
	admin.login("admin@campusconnect.test", "Admin123!")
	status, payload = admin.get("/api/v1/events?scope=all&upcoming=false&pageSize=100")
	expectStatus(t, status, http.StatusOK, payload)

	student := newClient(t)
	student.login("student01@campusconnect.test", "Password123!")
	status, payload = student.get("/api/v1/coordinator/events")
	expectStatus(t, status, http.StatusForbidden, payload)
	status, payload = student.get("/api/v1/events?scope=all")
	expectStatus(t, status, http.StatusForbidden, payload)
}

func TestMembershipJoinApprovalAndRoleGuards(t *testing.T) {
	resetSeed(t)
	ctx := context.Background()

	var clubID, studentID int64
	var enrollment string
	if err := testPool.QueryRow(ctx, `
		SELECT c.club_id, s.student_id, s.enrollment_number
		FROM clubs c
		CROSS JOIN students s
		JOIN users u ON u.user_id = s.user_id
		WHERE c.name = 'Coding Club' AND u.email = 'student01@campusconnect.test'
	`).Scan(&clubID, &studentID, &enrollment); err != nil {
		t.Fatalf("resolve student and club: %v", err)
	}
	if _, err := testPool.Exec(ctx, `DELETE FROM club_members WHERE club_id = $1 AND student_id = $2`, clubID, studentID); err != nil {
		t.Fatalf("clear membership: %v", err)
	}

	student := newClient(t)
	student.login("student01@campusconnect.test", "Password123!")
	status, payload := student.post("/api/v1/clubs/"+itoa(clubID)+"/join", nil)
	expectStatus(t, status, http.StatusCreated, payload)
	request := decodeData[map[string]any](t, payload)
	if request["status"] != "pending" {
		t.Fatalf("join should create a pending request: %s", payload)
	}

	status, payload = student.post("/api/v1/clubs/"+itoa(clubID)+"/join", nil)
	expectStatus(t, status, http.StatusConflict, payload)

	coordinator := newClient(t)
	coordinator.login("priya@campusconnect.test", "Coordinator123!")
	status, payload = coordinator.get("/api/v1/clubs/" + itoa(clubID) + "/members?status=pending&search=" + enrollment + "&pageSize=20")
	expectStatus(t, status, http.StatusOK, payload)
	pendingMembers := decodeData[[]map[string]any](t, payload)
	if len(pendingMembers) != 1 {
		t.Fatalf("expected the new pending member: %s", payload)
	}
	membershipID := int64(pendingMembers[0]["membershipId"].(float64))

	status, payload = coordinator.patch("/api/v1/clubs/"+itoa(clubID)+"/members/"+itoa(membershipID), map[string]any{
		"status": "approved",
	})
	expectStatus(t, status, http.StatusOK, payload)
	approved := decodeData[map[string]any](t, payload)
	if approved["status"] != "approved" || approved["joinedAt"] == nil {
		t.Fatalf("approval should stamp joinedAt: %s", payload)
	}

	status, payload = student.get("/api/v1/me/memberships")
	expectStatus(t, status, http.StatusOK, payload)
	memberships := decodeData[[]map[string]any](t, payload)
	approvedSeen := false
	for _, membership := range memberships {
		if int64(membership["clubId"].(float64)) == clubID && membership["status"] == "approved" {
			approvedSeen = true
		}
	}
	if !approvedSeen {
		t.Fatalf("student should see the approved membership: %s", payload)
	}

	status, payload = coordinator.get("/api/v1/clubs/" + itoa(clubID) + "/members?status=approved&search=Priya&pageSize=10")
	expectStatus(t, status, http.StatusOK, payload)
	coordinatorMembers := decodeData[[]map[string]any](t, payload)
	if len(coordinatorMembers) == 0 {
		t.Fatalf("expected coordinator membership: %s", payload)
	}
	coordinatorMembershipID := int64(coordinatorMembers[0]["membershipId"].(float64))

	status, payload = coordinator.patch(
		"/api/v1/clubs/"+itoa(clubID)+"/members/"+itoa(coordinatorMembershipID)+"/role",
		map[string]any{"role": "member"},
	)
	expectStatus(t, status, http.StatusConflict, payload)
	if !strings.Contains(string(payload), "coordinator") {
		t.Fatalf("last-coordinator guard should explain the conflict: %s", payload)
	}

	status, payload = coordinator.delete("/api/v1/clubs/" + itoa(clubID) + "/members/" + itoa(coordinatorMembershipID))
	expectStatus(t, status, http.StatusConflict, payload)

	status, payload = student.post("/api/v1/clubs/"+itoa(clubID)+"/join", nil)
	expectStatus(t, status, http.StatusConflict, payload)
}

func TestStudentSelfDashboard(t *testing.T) {
	resetSeed(t)
	student := newClient(t)
	student.login("student01@campusconnect.test", "Password123!")

	status, payload := student.get("/api/v1/me/dashboard")
	expectStatus(t, status, http.StatusOK, payload)
	dashboard := decodeData[map[string]any](t, payload)
	for _, key := range []string{
		"clubsJoined", "approvedMemberships", "pendingMemberships", "eventsRegistered",
		"upcomingRegistrations", "certificatesEarned", "upcomingEvents", "recentRegistrations",
	} {
		if _, ok := dashboard[key]; !ok {
			t.Fatalf("student dashboard missing %q: %s", key, payload)
		}
	}

	status, payload = student.get("/api/v1/me/registrations?page=1&pageSize=50")
	expectStatus(t, status, http.StatusOK, payload)
	registrations, meta := decodeDataWithMeta[[]map[string]any](t, payload)
	if len(registrations) == 0 || meta["total"].(float64) == 0 {
		t.Fatalf("expected seeded registrations: %s", payload)
	}

	status, payload = student.get("/api/v1/me/certificates")
	expectStatus(t, status, http.StatusOK, payload)
}

func TestValidationAndNotFound(t *testing.T) {
	resetSeed(t)
	admin := newClient(t)
	admin.login("admin@campusconnect.test", "Admin123!")

	status, payload := admin.post("/api/v1/admin/departments", map[string]any{"name": "X", "code": "toolongcode"})
	expectStatus(t, status, http.StatusUnprocessableEntity, payload)
	expectErrorCode(t, payload, "validation_error")

	status, payload = admin.post("/api/v1/admin/venues", map[string]any{"name": "", "capacity": 0, "location": ""})
	expectStatus(t, status, http.StatusUnprocessableEntity, payload)

	status, payload = admin.patch("/api/v1/admin/users/999999", map[string]any{"isActive": true})
	expectStatus(t, status, http.StatusNotFound, payload)

	coordinator := newClient(t)
	coordinator.login("priya@campusconnect.test", "Coordinator123!")
	status, payload = coordinator.get("/api/v1/coordinator/events/999999")
	expectStatus(t, status, http.StatusNotFound, payload)

	student := newClient(t)
	student.login("student01@campusconnect.test", "Password123!")
	status, payload = student.get("/api/v1/clubs/999999")
	expectStatus(t, status, http.StatusNotFound, payload)
}

func itoa(value int64) string {
	return strconv.FormatInt(value, 10)
}
