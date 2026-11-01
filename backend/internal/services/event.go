package services

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/campusconnect/backend/internal/apperr"
	"github.com/campusconnect/backend/internal/authctx"
	"github.com/campusconnect/backend/internal/models"
	"github.com/campusconnect/backend/internal/repositories"
	"github.com/jackc/pgx/v5"
)

// EventService owns event discovery, management, feedback, attendance and the
// coordinator dashboard rules.
type EventService struct {
	events        *repositories.EventRepository
	registrations *repositories.RegistrationRepository
	authz         *repositories.Authz
}

func NewEventService(
	events *repositories.EventRepository,
	registrations *repositories.RegistrationRepository,
	authz *repositories.Authz,
) *EventService {
	return &EventService{events: events, registrations: registrations, authz: authz}
}

type EventListFilter struct {
	Search   string
	ClubID   int64
	Status   string
	Scope    string
	Upcoming bool
	Page     int
	PageSize int
	Offset   int
}

type CreateEventInput struct {
	ClubID               int64
	VenueID              int64
	Title                string
	Description          string
	EventDate            time.Time
	RegistrationDeadline time.Time
	Capacity             int
}

type UpdateEventInput struct {
	ClubID               *int64
	VenueID              *int64
	Title                *string
	Description          *string
	EventDate            *time.Time
	RegistrationDeadline *time.Time
	Capacity             *int
}

type RegistrationListFilter struct {
	Status   string
	Search   string
	Page     int
	PageSize int
	Offset   int
}

type CreateFeedbackInput struct {
	Rating   int
	Comments string
}

type AttendanceMark struct {
	RegistrationID int64
	Status         string
}

type CertificateIssueResult struct {
	Issued       int                  `json:"issued"`
	Certificates []models.Certificate `json:"certificates"`
}

// ListPublic returns published events and attaches the caller's registration
// when they have a student profile.
func (s *EventService) ListPublic(ctx context.Context, principal authctx.Principal, filter EventListFilter) ([]models.Event, int, error) {
	events, total, err := s.events.ListPublic(ctx, repositories.ListEventsParams{
		Search:   filter.Search,
		ClubID:   filter.ClubID,
		Upcoming: filter.Upcoming,
		PageSize: filter.PageSize,
		Offset:   filter.Offset,
	})
	if err != nil {
		return nil, 0, eventStoreError("list public events", err)
	}
	if err := s.attachMyRegistrations(ctx, principal, events); err != nil {
		return nil, 0, err
	}
	return events, total, nil
}

// GetPublic returns a published or completed event with live counts.
func (s *EventService) GetPublic(ctx context.Context, principal authctx.Principal, eventID int64) (models.Event, error) {
	event, err := s.events.GetPublic(ctx, eventID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.Event{}, apperr.NotFound("Event not found.")
		}
		return models.Event{}, eventStoreError("load public event", err)
	}
	events := []models.Event{event}
	if err := s.attachMyRegistrations(ctx, principal, events); err != nil {
		return models.Event{}, err
	}
	return events[0], nil
}

// ListScoped returns events beyond public discovery. Coordinators can list
// every event for the clubs they manage (scope=managed); admins can list every
// event (scope=all).
func (s *EventService) ListScoped(ctx context.Context, principal authctx.Principal, filter EventListFilter) ([]models.Event, int, error) {
	scope := strings.ToLower(strings.TrimSpace(filter.Scope))
	if scope == "" {
		return s.ListPublic(ctx, principal, filter)
	}
	if filter.Status != "" && !eventValidStatus(filter.Status) {
		return nil, 0, apperr.Validation(map[string]string{"status": "Unknown event status."})
	}

	all := false
	switch scope {
	case "managed":
		if principal.IsAdmin() {
			all = true
		} else if !principal.IsCoordinator() {
			return nil, 0, apperr.Forbidden("Only coordinators and administrators can list managed events.")
		}
	case "all":
		if !principal.IsAdmin() {
			return nil, 0, apperr.Forbidden("Only administrators can list all events.")
		}
		all = true
	default:
		return nil, 0, apperr.Validation(map[string]string{"scope": "Scope must be managed or all."})
	}

	events, total, err := s.events.ListManaged(ctx, principal.UserID, all, repositories.ListEventsParams{
		Search:   filter.Search,
		ClubID:   filter.ClubID,
		Status:   filter.Status,
		Upcoming: filter.Upcoming,
		PageSize: filter.PageSize,
		Offset:   filter.Offset,
	})
	if err != nil {
		return nil, 0, eventStoreError("list managed events", err)
	}
	if err := s.attachMyRegistrations(ctx, principal, events); err != nil {
		return nil, 0, err
	}
	return events, total, nil
}

// GetManaged returns an event regardless of status when the caller coordinates
// its club (or is an administrator).
func (s *EventService) GetManaged(ctx context.Context, principal authctx.Principal, eventID int64) (models.Event, error) {
	event, err := s.loadEvent(ctx, eventID)
	if err != nil {
		return models.Event{}, err
	}
	if err := eventRequireManager(ctx, s.authz, principal, event); err != nil {
		return models.Event{}, err
	}
	events := []models.Event{event}
	if err := s.attachMyRegistrations(ctx, principal, events); err != nil {
		return models.Event{}, err
	}
	return events[0], nil
}

func (s *EventService) attachMyRegistrations(ctx context.Context, principal authctx.Principal, events []models.Event) error {
	if principal.StudentID == nil || len(events) == 0 {
		return nil
	}
	eventIDs := make([]int64, 0, len(events))
	for _, event := range events {
		eventIDs = append(eventIDs, event.EventID)
	}
	summaries, err := s.registrations.ListForEvents(ctx, *principal.StudentID, eventIDs)
	if err != nil {
		return eventStoreError("load my registrations", err)
	}
	for index := range events {
		if summary, ok := summaries[events[index].EventID]; ok {
			registration := summary
			events[index].MyRegistration = &registration
		}
	}
	return nil
}

func (s *EventService) Create(ctx context.Context, principal authctx.Principal, input CreateEventInput) (models.Event, error) {
	if err := eventRequireClubManager(ctx, s.authz, principal, input.ClubID); err != nil {
		return models.Event{}, err
	}

	input.Title = strings.TrimSpace(input.Title)
	input.Description = strings.TrimSpace(input.Description)
	fields := make(map[string]string)
	if input.Title == "" {
		fields["title"] = "Title cannot be blank."
	}
	eventValidateSchedule(fields, input.EventDate, input.RegistrationDeadline, input.Capacity)

	clubStatus, err := s.events.ClubStatus(ctx, input.ClubID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			fields["clubId"] = "Select an existing club."
		} else {
			return models.Event{}, eventStoreError("load event club", err)
		}
	} else if clubStatus != "approved" {
		fields["clubId"] = "Only approved clubs can host events."
	}

	venueCapacity, err := s.events.VenueCapacity(ctx, input.VenueID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			fields["venueId"] = "Select an existing venue."
		} else {
			return models.Event{}, eventStoreError("load event venue", err)
		}
	} else if input.Capacity > venueCapacity {
		fields["capacity"] = "Capacity cannot exceed the selected venue's capacity."
	}

	if len(fields) > 0 {
		return models.Event{}, apperr.Validation(fields)
	}

	eventID, err := s.events.Create(ctx, repositories.CreateEventParams{
		ClubID:               input.ClubID,
		VenueID:              input.VenueID,
		CreatedBy:            principal.UserID,
		Title:                input.Title,
		Description:          input.Description,
		EventDate:            input.EventDate,
		RegistrationDeadline: input.RegistrationDeadline,
		Capacity:             input.Capacity,
	})
	if err != nil {
		return models.Event{}, eventStoreError("create event", err)
	}
	event, err := s.events.GetByID(ctx, eventID)
	if err != nil {
		return models.Event{}, eventStoreError("load created event", err)
	}
	return event, nil
}

func (s *EventService) Update(ctx context.Context, principal authctx.Principal, eventID int64, input UpdateEventInput) (models.Event, error) {
	if input.ClubID == nil && input.VenueID == nil && input.Title == nil &&
		input.Description == nil && input.EventDate == nil &&
		input.RegistrationDeadline == nil && input.Capacity == nil {
		return models.Event{}, apperr.BadRequest("Provide at least one field to update.")
	}

	event, err := s.loadEvent(ctx, eventID)
	if err != nil {
		return models.Event{}, err
	}
	if err := eventRequireClubManager(ctx, s.authz, principal, event.ClubID); err != nil {
		return models.Event{}, err
	}
	if event.Status == "completed" || event.Status == "cancelled" {
		return models.Event{}, apperr.Conflict("Completed or cancelled events cannot be edited.")
	}

	merged := event
	if input.ClubID != nil {
		if *input.ClubID != event.ClubID {
			if err := eventRequireClubManager(ctx, s.authz, principal, *input.ClubID); err != nil {
				return models.Event{}, err
			}
		}
		merged.ClubID = *input.ClubID
	}
	if input.VenueID != nil {
		merged.VenueID = *input.VenueID
	}
	if input.Title != nil {
		merged.Title = strings.TrimSpace(*input.Title)
	}
	if input.Description != nil {
		merged.Description = strings.TrimSpace(*input.Description)
	}
	if input.EventDate != nil {
		merged.EventDate = *input.EventDate
	}
	if input.RegistrationDeadline != nil {
		merged.RegistrationDeadline = *input.RegistrationDeadline
	}
	if input.Capacity != nil {
		merged.Capacity = *input.Capacity
	}

	fields := make(map[string]string)
	if merged.Title == "" {
		fields["title"] = "Title cannot be blank."
	}
	eventValidateSchedule(fields, merged.EventDate, merged.RegistrationDeadline, merged.Capacity)

	clubStatus, err := s.events.ClubStatus(ctx, merged.ClubID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			fields["clubId"] = "Select an existing club."
		} else {
			return models.Event{}, eventStoreError("load event club", err)
		}
	} else if clubStatus != "approved" {
		fields["clubId"] = "Only approved clubs can host events."
	}

	venueCapacity, err := s.events.VenueCapacity(ctx, merged.VenueID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			fields["venueId"] = "Select an existing venue."
		} else {
			return models.Event{}, eventStoreError("load event venue", err)
		}
	} else if merged.Capacity > venueCapacity {
		fields["capacity"] = "Capacity cannot exceed the selected venue's capacity."
	}
	if merged.Capacity < event.ConfirmedCount {
		fields["capacity"] = "Capacity cannot be below the number of confirmed registrations."
	}

	if len(fields) > 0 {
		return models.Event{}, apperr.Validation(fields)
	}

	params := repositories.UpdateEventParams{
		ClubID:               input.ClubID,
		VenueID:              input.VenueID,
		EventDate:            input.EventDate,
		RegistrationDeadline: input.RegistrationDeadline,
		Capacity:             input.Capacity,
	}
	if input.Title != nil {
		params.Title = &merged.Title
	}
	if input.Description != nil {
		params.Description = &merged.Description
	}
	if err := s.events.Update(ctx, eventID, params); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.Event{}, apperr.NotFound("Event not found.")
		}
		return models.Event{}, eventStoreError("update event", err)
	}
	updated, err := s.events.GetByID(ctx, eventID)
	if err != nil {
		return models.Event{}, eventStoreError("load updated event", err)
	}
	return updated, nil
}

func (s *EventService) Delete(ctx context.Context, principal authctx.Principal, eventID int64) error {
	event, err := s.loadEvent(ctx, eventID)
	if err != nil {
		return err
	}
	if err := eventRequireClubManager(ctx, s.authz, principal, event.ClubID); err != nil {
		return err
	}
	if event.TotalRegistrations > 0 {
		return apperr.Conflict("Events with registrations cannot be deleted.")
	}
	if err := s.events.Delete(ctx, eventID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return apperr.NotFound("Event not found.")
		}
		return eventStoreError("delete event", err)
	}
	return nil
}

func (s *EventService) ListRegistrations(ctx context.Context, principal authctx.Principal, eventID int64, filter RegistrationListFilter) ([]models.Registration, int, error) {
	event, err := s.loadEvent(ctx, eventID)
	if err != nil {
		return nil, 0, err
	}
	if err := eventRequireClubManager(ctx, s.authz, principal, event.ClubID); err != nil {
		return nil, 0, err
	}
	registrations, total, err := s.registrations.ListEventRegistrations(ctx, repositories.ListRegistrationsParams{
		EventID:  eventID,
		Status:   filter.Status,
		Search:   filter.Search,
		PageSize: filter.PageSize,
		Offset:   filter.Offset,
	})
	if err != nil {
		return nil, 0, eventStoreError("list event registrations", err)
	}
	return registrations, total, nil
}

func (s *EventService) ListFeedback(ctx context.Context, principal authctx.Principal, eventID int64) ([]models.Feedback, error) {
	event, err := s.loadEvent(ctx, eventID)
	if err != nil {
		return nil, err
	}

	switch {
	case principal.IsAdmin():
		feedback, err := s.registrations.ListFeedback(ctx, eventID, nil)
		if err != nil {
			return nil, eventStoreError("list event feedback", err)
		}
		return feedback, nil
	case principal.IsCoordinator():
		if err := eventRequireClubManager(ctx, s.authz, principal, event.ClubID); err != nil {
			return nil, err
		}
		feedback, err := s.registrations.ListFeedback(ctx, eventID, nil)
		if err != nil {
			return nil, eventStoreError("list event feedback", err)
		}
		return feedback, nil
	}

	studentID, err := eventStudentID(principal)
	if err != nil {
		return nil, err
	}
	confirmed, err := s.registrations.HasConfirmedRegistration(ctx, studentID, eventID)
	if err != nil {
		return nil, eventStoreError("check event registration", err)
	}
	if !confirmed {
		return nil, apperr.Forbidden("Only confirmed registrants can view feedback for this event.")
	}
	feedback, err := s.registrations.ListFeedback(ctx, eventID, &studentID)
	if err != nil {
		return nil, eventStoreError("list own event feedback", err)
	}
	return feedback, nil
}

func (s *EventService) CreateFeedback(ctx context.Context, principal authctx.Principal, eventID int64, input CreateFeedbackInput) (models.Feedback, error) {
	studentID, err := eventStudentID(principal)
	if err != nil {
		return models.Feedback{}, err
	}
	event, err := s.loadEvent(ctx, eventID)
	if err != nil {
		return models.Feedback{}, err
	}

	fields := make(map[string]string)
	if input.Rating < 1 || input.Rating > 5 {
		fields["rating"] = "Rating must be between 1 and 5."
	}
	comments := strings.TrimSpace(input.Comments)
	if utf8.RuneCountInString(comments) > 1000 {
		fields["comments"] = "Comments must be at most 1000 characters."
	}
	if len(fields) > 0 {
		return models.Feedback{}, apperr.Validation(fields)
	}
	if time.Now().Before(event.EventDate) {
		return models.Feedback{}, apperr.Conflict("Feedback opens once the event has started.")
	}

	confirmed, err := s.registrations.HasConfirmedRegistration(ctx, studentID, eventID)
	if err != nil {
		return models.Feedback{}, eventStoreError("check feedback registration", err)
	}
	if !confirmed {
		return models.Feedback{}, apperr.Forbidden("Only confirmed registrants can leave feedback.")
	}

	existing, err := s.registrations.HasFeedback(ctx, studentID, eventID)
	if err != nil {
		return models.Feedback{}, eventStoreError("check existing feedback", err)
	}
	if existing {
		return models.Feedback{}, apperr.Conflict("You have already submitted feedback for this event.")
	}

	feedbackID, err := s.registrations.CreateFeedback(ctx, studentID, eventID, input.Rating, comments)
	if err != nil {
		return models.Feedback{}, eventStoreError("create feedback", err)
	}
	feedback, err := s.registrations.FeedbackByID(ctx, feedbackID)
	if err != nil {
		return models.Feedback{}, eventStoreError("load feedback", err)
	}
	return feedback, nil
}

func (s *EventService) Stats(ctx context.Context, principal authctx.Principal, eventID int64) (models.EventStats, error) {
	event, err := s.loadEvent(ctx, eventID)
	if err != nil {
		return models.EventStats{}, err
	}
	if err := eventRequireClubManager(ctx, s.authz, principal, event.ClubID); err != nil {
		return models.EventStats{}, err
	}
	stats, err := s.events.Stats(ctx, eventID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.EventStats{}, apperr.NotFound("Event not found.")
		}
		return models.EventStats{}, eventStoreError("load event stats", err)
	}
	return stats, nil
}

func (s *EventService) MarkAttendance(ctx context.Context, principal authctx.Principal, eventID int64, marks []AttendanceMark) ([]models.Attendance, error) {
	event, err := s.loadEvent(ctx, eventID)
	if err != nil {
		return nil, err
	}
	if err := eventRequireClubManager(ctx, s.authz, principal, event.ClubID); err != nil {
		return nil, err
	}
	if len(marks) == 0 {
		return nil, apperr.BadRequest("Provide at least one attendance entry.")
	}

	entries := make([]repositories.AttendanceEntry, 0, len(marks))
	for _, mark := range marks {
		if mark.RegistrationID <= 0 || (mark.Status != "present" && mark.Status != "absent") {
			return nil, apperr.Validation(map[string]string{
				"entries": "Each entry needs a valid registrationId and a status of present or absent.",
			})
		}
		entries = append(entries, repositories.AttendanceEntry{
			RegistrationID: mark.RegistrationID,
			Status:         mark.Status,
		})
	}

	attendances, err := s.registrations.UpsertEventAttendance(ctx, eventID, entries, principal.UserID)
	if err != nil {
		return nil, eventStoreError("mark event attendance", err)
	}
	return attendances, nil
}

func (s *EventService) IssueCertificates(ctx context.Context, principal authctx.Principal, eventID int64) (CertificateIssueResult, error) {
	event, err := s.loadEvent(ctx, eventID)
	if err != nil {
		return CertificateIssueResult{}, err
	}
	if err := eventRequireClubManager(ctx, s.authz, principal, event.ClubID); err != nil {
		return CertificateIssueResult{}, err
	}
	certificates, err := s.registrations.AwardCertificates(ctx, eventID)
	if err != nil {
		return CertificateIssueResult{}, eventStoreError("issue event certificates", err)
	}
	return CertificateIssueResult{
		Issued:       len(certificates),
		Certificates: certificates,
	}, nil
}

func (s *EventService) Dashboard(ctx context.Context, principal authctx.Principal) (models.CoordinatorDashboard, error) {
	if !principal.IsCoordinator() {
		return models.CoordinatorDashboard{}, apperr.Forbidden("Only coordinators can view the coordinator dashboard.")
	}

	clubs, err := s.events.CoordinatedClubs(ctx, principal.UserID)
	if err != nil {
		return models.CoordinatorDashboard{}, eventStoreError("load coordinated clubs", err)
	}
	stats, err := s.events.CoordinatorStats(ctx, principal.UserID)
	if err != nil {
		return models.CoordinatorDashboard{}, eventStoreError("load coordinator stats", err)
	}
	pendingMembers, err := s.events.CoordinatorPendingMembers(ctx, principal.UserID, 10)
	if err != nil {
		return models.CoordinatorDashboard{}, eventStoreError("load coordinator pending members", err)
	}
	upcomingEvents, err := s.events.CoordinatorUpcomingEvents(ctx, principal.UserID, 5)
	if err != nil {
		return models.CoordinatorDashboard{}, eventStoreError("load coordinator upcoming events", err)
	}
	recentFeedback, err := s.events.CoordinatorRecentFeedback(ctx, principal.UserID, 5)
	if err != nil {
		return models.CoordinatorDashboard{}, eventStoreError("load coordinator recent feedback", err)
	}

	return models.CoordinatorDashboard{
		Clubs:          clubs,
		Stats:          stats,
		PendingMembers: pendingMembers,
		UpcomingEvents: upcomingEvents,
		RecentFeedback: recentFeedback,
	}, nil
}

func (s *EventService) loadEvent(ctx context.Context, eventID int64) (models.Event, error) {
	event, err := s.events.GetByID(ctx, eventID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.Event{}, apperr.NotFound("Event not found.")
		}
		return models.Event{}, eventStoreError("load event", err)
	}
	return event, nil
}

func eventValidateSchedule(fields map[string]string, eventDate, deadline time.Time, capacity int) {
	now := time.Now()
	if !eventDate.After(now) {
		fields["eventDate"] = "Event date must be in the future."
	}
	if !deadline.After(now) {
		fields["registrationDeadline"] = "Registration deadline must be in the future."
	} else if deadline.After(eventDate) {
		fields["registrationDeadline"] = "Registration deadline must be on or before the event date."
	}
	if capacity <= 0 {
		fields["capacity"] = "Capacity must be greater than zero."
	}
}

func eventRequireClubManager(ctx context.Context, authz *repositories.Authz, principal authctx.Principal, clubID int64) error {
	if principal.IsAdmin() {
		return nil
	}
	if !principal.IsCoordinator() {
		return apperr.Forbidden("You do not have permission to manage this club's events.")
	}
	ok, err := authz.IsClubCoordinator(ctx, principal.UserID, clubID)
	if err != nil {
		return eventStoreError("check club coordinator", err)
	}
	if !ok {
		return apperr.Forbidden("You do not have permission to manage this club's events.")
	}
	return nil
}

func eventRequireManager(ctx context.Context, authz *repositories.Authz, principal authctx.Principal, event models.Event) error {
	return eventRequireClubManager(ctx, authz, principal, event.ClubID)
}

func eventStudentID(principal authctx.Principal) (int64, error) {
	if principal.StudentID == nil || *principal.StudentID <= 0 {
		return 0, apperr.Forbidden("A student profile is required for this action.")
	}
	return *principal.StudentID, nil
}

func eventValidStatus(status string) bool {
	switch status {
	case "draft", "pending", "published", "rejected", "completed", "cancelled":
		return true
	default:
		return false
	}
}

func eventStoreError(action string, err error) error {
	if appErr, ok := apperr.As(err); ok {
		return appErr
	}
	slog.Error("event service: "+action, "error", err)
	return apperr.Internal(err)
}
