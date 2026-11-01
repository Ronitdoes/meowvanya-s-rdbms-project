package handlers

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/campusconnect/backend/internal/apperr"
	"github.com/campusconnect/backend/internal/authctx"
	"github.com/campusconnect/backend/internal/httpx"
	"github.com/campusconnect/backend/internal/services"
	"github.com/go-playground/validator/v10"
)

// EventHandler exposes public event discovery, event management and
// coordinator-facing event operations.
type EventHandler struct {
	svc      *services.EventService
	validate *validator.Validate
}

func NewEventHandler(svc *services.EventService, validate *validator.Validate) *EventHandler {
	return &EventHandler{svc: svc, validate: validate}
}

type eventCreateRequest struct {
	ClubID               int64     `json:"clubId" validate:"required,gt=0"`
	VenueID              int64     `json:"venueId" validate:"required,gt=0"`
	Title                string    `json:"title" validate:"required"`
	Description          string    `json:"description"`
	EventDate            time.Time `json:"eventDate" validate:"required"`
	RegistrationDeadline time.Time `json:"registrationDeadline" validate:"required"`
	Capacity             int       `json:"capacity" validate:"required,gt=0"`
}

type eventUpdateRequest struct {
	ClubID               *int64     `json:"clubId" validate:"omitempty,gt=0"`
	VenueID              *int64     `json:"venueId" validate:"omitempty,gt=0"`
	Title                *string    `json:"title"`
	Description          *string    `json:"description"`
	EventDate            *time.Time `json:"eventDate"`
	RegistrationDeadline *time.Time `json:"registrationDeadline"`
	Capacity             *int       `json:"capacity" validate:"omitempty,gt=0"`
}

type eventFeedbackRequest struct {
	Rating   int    `json:"rating" validate:"required,min=1,max=5"`
	Comments string `json:"comments" validate:"max=1000"`
}

type attendanceEntryRequest struct {
	RegistrationID int64  `json:"registrationId"`
	Status         string `json:"status"`
}

type eventAttendanceRequest struct {
	Entries []attendanceEntryRequest `json:"entries"`
}

func (h *EventHandler) List(w http.ResponseWriter, r *http.Request) {
	scope := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("scope")))
	h.list(w, r, scope)
}

// ListManaged returns every event for the clubs the caller coordinates.
func (h *EventHandler) ListManaged(w http.ResponseWriter, r *http.Request) {
	h.list(w, r, "managed")
}

func (h *EventHandler) list(w http.ResponseWriter, r *http.Request, scope string) {
	page, pageSize, offset := httpx.Pagination(r)

	clubID, err := eventOptionalInt64(r, "clubId")
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	upcoming := scope == ""
	if raw := strings.TrimSpace(r.URL.Query().Get("upcoming")); raw != "" {
		upcoming = raw == "true" || raw == "1"
	}

	filter := services.EventListFilter{
		Search:   httpx.QueryString(r, "search"),
		ClubID:   clubID,
		Status:   strings.ToLower(strings.TrimSpace(r.URL.Query().Get("status"))),
		Scope:    scope,
		Upcoming: upcoming,
		Page:     page,
		PageSize: pageSize,
		Offset:   offset,
	}
	principal := authctx.MustFromRequest(r)

	events, total, err := h.svc.ListScoped(r.Context(), principal, filter)
	if err != nil {
		h.fail(w, "list events", err)
		return
	}
	httpx.Paginated(w, events, page, pageSize, total)
}

func (h *EventHandler) Get(w http.ResponseWriter, r *http.Request) {
	eventID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	principal := authctx.MustFromRequest(r)
	event, err := h.svc.GetPublic(r.Context(), principal, eventID)
	if err != nil {
		h.fail(w, "get event", err)
		return
	}
	httpx.JSON(w, http.StatusOK, event)
}

// GetManaged returns an event in any status to its coordinator or an admin.
func (h *EventHandler) GetManaged(w http.ResponseWriter, r *http.Request) {
	eventID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	principal := authctx.MustFromRequest(r)
	event, err := h.svc.GetManaged(r.Context(), principal, eventID)
	if err != nil {
		h.fail(w, "get managed event", err)
		return
	}
	httpx.JSON(w, http.StatusOK, event)
}

func (h *EventHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req eventCreateRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.FailError(w, err)
		return
	}
	fields, err := eventValidatePayload(h.validate, &req)
	if err != nil {
		h.fail(w, "validate create event payload", err)
		return
	}
	if len(fields) > 0 {
		httpx.FailError(w, apperr.Validation(fields))
		return
	}

	principal := authctx.MustFromRequest(r)
	event, err := h.svc.Create(r.Context(), principal, services.CreateEventInput{
		ClubID:               req.ClubID,
		VenueID:              req.VenueID,
		Title:                req.Title,
		Description:          req.Description,
		EventDate:            req.EventDate,
		RegistrationDeadline: req.RegistrationDeadline,
		Capacity:             req.Capacity,
	})
	if err != nil {
		h.fail(w, "create event", err)
		return
	}
	httpx.Created(w, event)
}

func (h *EventHandler) Update(w http.ResponseWriter, r *http.Request) {
	eventID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	var req eventUpdateRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.FailError(w, err)
		return
	}
	if req.ClubID == nil && req.VenueID == nil && req.Title == nil &&
		req.Description == nil && req.EventDate == nil &&
		req.RegistrationDeadline == nil && req.Capacity == nil {
		httpx.FailError(w, apperr.BadRequest("Provide at least one field to update."))
		return
	}

	fields, err := eventValidatePayload(h.validate, &req)
	if err != nil {
		h.fail(w, "validate update event payload", err)
		return
	}
	if len(fields) > 0 {
		httpx.FailError(w, apperr.Validation(fields))
		return
	}

	principal := authctx.MustFromRequest(r)
	event, err := h.svc.Update(r.Context(), principal, eventID, services.UpdateEventInput{
		ClubID:               req.ClubID,
		VenueID:              req.VenueID,
		Title:                req.Title,
		Description:          req.Description,
		EventDate:            req.EventDate,
		RegistrationDeadline: req.RegistrationDeadline,
		Capacity:             req.Capacity,
	})
	if err != nil {
		h.fail(w, "update event", err)
		return
	}
	httpx.JSON(w, http.StatusOK, event)
}

func (h *EventHandler) Delete(w http.ResponseWriter, r *http.Request) {
	eventID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	principal := authctx.MustFromRequest(r)
	if err := h.svc.Delete(r.Context(), principal, eventID); err != nil {
		h.fail(w, "delete event", err)
		return
	}
	httpx.NoContent(w)
}

func (h *EventHandler) ListRegistrations(w http.ResponseWriter, r *http.Request) {
	eventID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	page, pageSize, offset := httpx.Pagination(r)
	principal := authctx.MustFromRequest(r)
	registrations, total, err := h.svc.ListRegistrations(r.Context(), principal, eventID, services.RegistrationListFilter{
		Status:   httpx.QueryString(r, "status"),
		Search:   httpx.QueryString(r, "search"),
		Page:     page,
		PageSize: pageSize,
		Offset:   offset,
	})
	if err != nil {
		h.fail(w, "list event registrations", err)
		return
	}
	httpx.Paginated(w, registrations, page, pageSize, total)
}

func (h *EventHandler) ListFeedback(w http.ResponseWriter, r *http.Request) {
	eventID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	principal := authctx.MustFromRequest(r)
	feedback, err := h.svc.ListFeedback(r.Context(), principal, eventID)
	if err != nil {
		h.fail(w, "list event feedback", err)
		return
	}
	httpx.JSON(w, http.StatusOK, feedback)
}

func (h *EventHandler) CreateFeedback(w http.ResponseWriter, r *http.Request) {
	eventID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	var req eventFeedbackRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.FailError(w, err)
		return
	}
	fields, err := eventValidatePayload(h.validate, &req)
	if err != nil {
		h.fail(w, "validate feedback payload", err)
		return
	}
	if len(fields) > 0 {
		httpx.FailError(w, apperr.Validation(fields))
		return
	}

	principal := authctx.MustFromRequest(r)
	feedback, err := h.svc.CreateFeedback(r.Context(), principal, eventID, services.CreateFeedbackInput{
		Rating:   req.Rating,
		Comments: req.Comments,
	})
	if err != nil {
		h.fail(w, "create event feedback", err)
		return
	}
	httpx.Created(w, feedback)
}

func (h *EventHandler) Stats(w http.ResponseWriter, r *http.Request) {
	eventID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	principal := authctx.MustFromRequest(r)
	stats, err := h.svc.Stats(r.Context(), principal, eventID)
	if err != nil {
		h.fail(w, "load event stats", err)
		return
	}
	httpx.JSON(w, http.StatusOK, stats)
}

func (h *EventHandler) MarkAttendance(w http.ResponseWriter, r *http.Request) {
	eventID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	var req eventAttendanceRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.FailError(w, err)
		return
	}
	if len(req.Entries) == 0 {
		httpx.FailError(w, apperr.BadRequest("Provide at least one attendance entry."))
		return
	}
	for _, entry := range req.Entries {
		if entry.RegistrationID <= 0 || (entry.Status != "present" && entry.Status != "absent") {
			httpx.FailError(w, apperr.Validation(map[string]string{
				"entries": "Each entry needs a valid registrationId and a status of present or absent.",
			}))
			return
		}
	}

	marks := make([]services.AttendanceMark, 0, len(req.Entries))
	for _, entry := range req.Entries {
		marks = append(marks, services.AttendanceMark{
			RegistrationID: entry.RegistrationID,
			Status:         entry.Status,
		})
	}

	principal := authctx.MustFromRequest(r)
	attendances, err := h.svc.MarkAttendance(r.Context(), principal, eventID, marks)
	if err != nil {
		h.fail(w, "mark event attendance", err)
		return
	}
	httpx.JSON(w, http.StatusOK, attendances)
}

func (h *EventHandler) IssueCertificates(w http.ResponseWriter, r *http.Request) {
	eventID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	principal := authctx.MustFromRequest(r)
	result, err := h.svc.IssueCertificates(r.Context(), principal, eventID)
	if err != nil {
		h.fail(w, "issue event certificates", err)
		return
	}
	httpx.JSON(w, http.StatusOK, result)
}

func (h *EventHandler) Dashboard(w http.ResponseWriter, r *http.Request) {
	principal := authctx.MustFromRequest(r)
	dashboard, err := h.svc.Dashboard(r.Context(), principal)
	if err != nil {
		h.fail(w, "load coordinator dashboard", err)
		return
	}
	httpx.JSON(w, http.StatusOK, dashboard)
}

func (h *EventHandler) fail(w http.ResponseWriter, action string, err error) {
	if _, ok := apperr.As(err); !ok {
		slog.Error("event handler: "+action, "error", err)
		httpx.FailError(w, apperr.Internal(err))
		return
	}
	httpx.FailError(w, err)
}

func eventOptionalInt64(r *http.Request, name string) (int64, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(name))
	if raw == "" {
		return 0, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		return 0, apperr.BadRequest("Invalid " + name + ".")
	}
	return value, nil
}

func eventValidatePayload(validate *validator.Validate, payload any) (map[string]string, error) {
	err := validate.Struct(payload)
	if err == nil {
		return nil, nil
	}
	var fieldErrors validator.ValidationErrors
	if !errors.As(err, &fieldErrors) {
		return nil, err
	}
	return eventValidationFields(payload, fieldErrors), nil
}

// eventValidationFields converts validator errors into messages keyed by the
// camelCase JSON field names used by the API.
func eventValidationFields(payload any, errs validator.ValidationErrors) map[string]string {
	fields := make(map[string]string, len(errs))
	for _, fieldErr := range errs {
		fields[eventFieldName(payload, fieldErr)] = eventFieldMessage(fieldErr)
	}
	return fields
}

func eventFieldName(payload any, fieldErr validator.FieldError) string {
	name := fieldErr.Field()
	if name != "" {
		name = strings.ToLower(name[:1]) + name[1:]
	}

	typ := reflect.TypeOf(payload)
	for typ != nil && typ.Kind() == reflect.Pointer {
		typ = typ.Elem()
	}
	if typ != nil && typ.Kind() == reflect.Struct {
		if field, ok := typ.FieldByName(fieldErr.StructField()); ok {
			if tag := strings.Split(field.Tag.Get("json"), ",")[0]; tag != "" && tag != "-" {
				return tag
			}
		}
	}
	return name
}

func eventFieldMessage(fieldErr validator.FieldError) string {
	switch fieldErr.Tag() {
	case "required":
		return "This field is required."
	case "min":
		if fieldErr.Kind() == reflect.String {
			return fmt.Sprintf("Must be at least %s characters.", fieldErr.Param())
		}
		return fmt.Sprintf("Must be at least %s.", fieldErr.Param())
	case "max":
		if fieldErr.Kind() == reflect.String {
			return fmt.Sprintf("Must be at most %s characters.", fieldErr.Param())
		}
		return fmt.Sprintf("Must be at most %s.", fieldErr.Param())
	case "gt":
		return fmt.Sprintf("Must be greater than %s.", fieldErr.Param())
	case "gte":
		return fmt.Sprintf("Must be at least %s.", fieldErr.Param())
	case "oneof":
		return fmt.Sprintf("Must be one of: %s.", fieldErr.Param())
	default:
		return "This value is invalid."
	}
}
