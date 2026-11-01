package tests

import (
	"net/http"
	"testing"
	"time"
)

func TestAdminDirectoryCRUDAndEventReview(t *testing.T) {
	resetSeed(t)

	admin := newClient(t)
	admin.login("admin@campusconnect.test", "Admin123!")

	status, payload := admin.post("/api/v1/admin/departments", map[string]any{
		"name": "Integration Studies",
		"code": "INT",
	})
	expectStatus(t, status, http.StatusCreated, payload)
	department := decodeData[map[string]any](t, payload)
	departmentID := int64(department["departmentId"].(float64))

	status, payload = admin.post("/api/v1/admin/departments", map[string]any{
		"name": "Duplicate Integration",
		"code": "INT",
	})
	expectStatus(t, status, http.StatusUnprocessableEntity, payload)

	status, payload = admin.post("/api/v1/admin/venues", map[string]any{
		"name":     "Integration Hall",
		"capacity": 50,
		"location": "Test Block",
	})
	expectStatus(t, status, http.StatusCreated, payload)
	venue := decodeData[map[string]any](t, payload)
	venueID := int64(venue["venueId"].(float64))

	status, payload = admin.post("/api/v1/admin/students", map[string]any{
		"email":            "integration.student@campusconnect.test",
		"password":         "Password123!",
		"fullName":         "Integration Student",
		"enrollmentNumber": "INT2026001",
		"departmentId":     departmentID,
		"role":             "student",
	})
	expectStatus(t, status, http.StatusCreated, payload)
	student := decodeData[map[string]any](t, payload)
	studentID := int64(student["studentId"].(float64))
	if student["departmentName"] != "Integration Studies" {
		t.Fatalf("admin student response lacks joined department: %s", payload)
	}
	studentUserID := int64(student["userId"].(float64))

	status, payload = admin.post("/api/v1/admin/clubs", map[string]any{
		"name":        "Integration Club",
		"description": "Created by the integration test suite.",
		"status":      "pending",
	})
	expectStatus(t, status, http.StatusCreated, payload)
	club := decodeData[map[string]any](t, payload)
	clubID := int64(club["clubId"].(float64))

	status, payload = admin.patch("/api/v1/admin/clubs/"+itoa(clubID), map[string]any{"status": "approved"})
	expectStatus(t, status, http.StatusOK, payload)

	status, payload = admin.post("/api/v1/admin/clubs/"+itoa(clubID)+"/coordinator", map[string]any{
		"studentId": studentID,
	})
	expectStatus(t, status, http.StatusOK, payload)
	withCoordinator := decodeData[map[string]any](t, payload)
	if withCoordinator["coordinatorName"] != "Integration Student" {
		t.Fatalf("coordinator assignment not reflected: %s", payload)
	}

	eventDate := time.Now().Add(10 * 24 * time.Hour).UTC().Format(time.RFC3339)
	deadline := time.Now().Add(8 * 24 * time.Hour).UTC().Format(time.RFC3339)
	status, payload = admin.post("/api/v1/events", map[string]any{
		"clubId":               clubID,
		"venueId":              venueID,
		"title":                "Integration Review Event",
		"description":          "Admin-created event awaiting review.",
		"eventDate":            eventDate,
		"registrationDeadline": deadline,
		"capacity":             25,
	})
	expectStatus(t, status, http.StatusCreated, payload)
	event := decodeData[map[string]any](t, payload)
	eventID := int64(event["eventId"].(float64))

	status, payload = admin.patch("/api/v1/admin/events/"+itoa(eventID)+"/status", map[string]any{
		"status":          "rejected",
		"rejectionReason": "Venue clash with another faculty event.",
	})
	expectStatus(t, status, http.StatusOK, payload)
	rejected := decodeData[map[string]any](t, payload)
	if rejected["status"] != "rejected" || rejected["rejectionReason"] == nil {
		t.Fatalf("rejection reason not stored: %s", payload)
	}

	// Rejected events can be resubmitted for review.
	status, payload = admin.patch("/api/v1/admin/events/"+itoa(eventID)+"/status", map[string]any{"status": "pending"})
	expectStatus(t, status, http.StatusOK, payload)
	status, payload = admin.patch("/api/v1/admin/events/"+itoa(eventID)+"/status", map[string]any{"status": "published"})
	expectStatus(t, status, http.StatusOK, payload)

	// Illegal transition: published cannot go back to pending.
	status, payload = admin.patch("/api/v1/admin/events/"+itoa(eventID)+"/status", map[string]any{"status": "pending"})
	expectStatus(t, status, http.StatusConflict, payload)

	// Referenced rows cannot be deleted.
	status, payload = admin.delete("/api/v1/admin/departments/" + itoa(departmentID))
	expectStatus(t, status, http.StatusConflict, payload)
	status, payload = admin.delete("/api/v1/admin/venues/" + itoa(venueID))
	expectStatus(t, status, http.StatusConflict, payload)
	status, payload = admin.delete("/api/v1/admin/clubs/" + itoa(clubID))
	expectStatus(t, status, http.StatusConflict, payload)

	// Admins cannot lock themselves out.
	status, payload = admin.patch("/api/v1/admin/users/1", map[string]any{"isActive": false})
	expectStatus(t, status, http.StatusConflict, payload)

	// The new student can sign in and the coordinator assignment is visible.
	createdStudent := newClient(t)
	createdStudent.login("integration.student@campusconnect.test", "Password123!")
	status, payload = createdStudent.get("/api/v1/me/coordinated-clubs")
	expectStatus(t, status, http.StatusOK, payload)
	coordinated := decodeData[[]map[string]any](t, payload)
	if len(coordinated) != 1 || coordinated[0]["name"] != "Integration Club" {
		t.Fatalf("new coordinator should see the club: %s", payload)
	}

	// Updating the student profile keeps the joined view intact.
	status, payload = admin.patch("/api/v1/admin/students/"+itoa(studentID), map[string]any{
		"fullName": "Integration Student Updated",
	})
	expectStatus(t, status, http.StatusOK, payload)
	updated := decodeData[map[string]any](t, payload)
	if updated["fullName"] != "Integration Student Updated" {
		t.Fatalf("student update failed: %s", payload)
	}

	// Deactivating a different user takes effect immediately.
	status, payload = admin.patch("/api/v1/admin/users/"+itoa(studentUserID), map[string]any{"isActive": false})
	expectStatus(t, status, http.StatusOK, payload)
	status, payload = createdStudent.get("/api/v1/auth/me")
	expectStatus(t, status, http.StatusUnauthorized, payload)
}
