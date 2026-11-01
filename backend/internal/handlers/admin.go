package handlers

import (
	"errors"
	"log/slog"
	"net/http"
	"reflect"
	"regexp"
	"strconv"
	"strings"

	"github.com/campusconnect/backend/internal/apperr"
	"github.com/campusconnect/backend/internal/authctx"
	"github.com/campusconnect/backend/internal/httpx"
	"github.com/campusconnect/backend/internal/services"
	"github.com/go-playground/validator/v10"
)

// AdminHandler exposes the public directory and admin-only endpoints.
type AdminHandler struct {
	svc      *services.AdminService
	validate *validator.Validate
}

func NewAdminHandler(svc *services.AdminService, validate *validator.Validate) *AdminHandler {
	return &AdminHandler{svc: svc, validate: validate}
}

var (
	adminEnrollmentPattern    = regexp.MustCompile(`^[A-Za-z0-9-]{4,24}$`)
	adminDepartmentCodeFormat = regexp.MustCompile(`^[A-Z]{2,8}$`)
)

// ---------------------------------------------------------------------------
// Public directory
// ---------------------------------------------------------------------------

func (h *AdminHandler) ListDepartments(w http.ResponseWriter, r *http.Request) {
	departments, err := h.svc.ListDepartments(r.Context())
	if err != nil {
		h.fail(w, "list departments", err)
		return
	}
	httpx.JSON(w, http.StatusOK, departments)
}

func (h *AdminHandler) ListVenues(w http.ResponseWriter, r *http.Request) {
	venues, err := h.svc.ListVenues(r.Context())
	if err != nil {
		h.fail(w, "list venues", err)
		return
	}
	httpx.JSON(w, http.StatusOK, venues)
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

func (h *AdminHandler) Dashboard(w http.ResponseWriter, r *http.Request) {
	dashboard, err := h.svc.Dashboard(r.Context())
	if err != nil {
		h.fail(w, "load admin dashboard", err)
		return
	}
	httpx.JSON(w, http.StatusOK, dashboard)
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

func (h *AdminHandler) ListUsers(w http.ResponseWriter, r *http.Request) {
	page, pageSize, offset := httpx.Pagination(r)

	users, total, err := h.svc.ListUsers(r.Context(), services.AdminUserListInput{
		Search: httpx.QueryString(r, "search"),
		Role:   httpx.QueryString(r, "role"),
		Limit:  pageSize,
		Offset: offset,
	})
	if err != nil {
		h.fail(w, "list users", err)
		return
	}
	httpx.Paginated(w, users, page, pageSize, total)
}

type adminUpdateUserRequest struct {
	IsActive *bool   `json:"isActive"`
	Role     *string `json:"role" validate:"omitempty,oneof=student coordinator admin"`
}

func (h *AdminHandler) UpdateUser(w http.ResponseWriter, r *http.Request) {
	userID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}

	var req adminUpdateUserRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.FailError(w, err)
		return
	}
	if req.Role != nil {
		role := strings.ToLower(strings.TrimSpace(*req.Role))
		req.Role = &role
	}
	fields, err := h.validatePayload(&req)
	if err != nil {
		h.fail(w, "validate user payload", err)
		return
	}
	if len(fields) > 0 {
		httpx.FailError(w, apperr.Validation(fields))
		return
	}
	if req.IsActive == nil && req.Role == nil {
		httpx.FailError(w, apperr.BadRequest("Provide at least one field to update."))
		return
	}

	principal := authctx.MustFromRequest(r)
	user, err := h.svc.UpdateUser(r.Context(), principal, userID, services.AdminUpdateUserInput{
		IsActive: req.IsActive,
		Role:     req.Role,
	})
	if err != nil {
		h.fail(w, "update user", err)
		return
	}
	httpx.JSON(w, http.StatusOK, user)
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

func (h *AdminHandler) ListStudents(w http.ResponseWriter, r *http.Request) {
	page, pageSize, offset := httpx.Pagination(r)

	departmentID, err := adminQueryID(r, "departmentId")
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	var departmentFilter int64
	if departmentID != nil {
		departmentFilter = *departmentID
	}

	students, total, err := h.svc.ListStudents(r.Context(), services.AdminStudentListInput{
		Search:       httpx.QueryString(r, "search"),
		DepartmentID: departmentFilter,
		Limit:        pageSize,
		Offset:       offset,
	})
	if err != nil {
		h.fail(w, "list students", err)
		return
	}
	httpx.Paginated(w, students, page, pageSize, total)
}

type adminCreateStudentRequest struct {
	Email            string `json:"email" validate:"required,email"`
	Password         string `json:"password" validate:"required,min=8"`
	FullName         string `json:"fullName" validate:"required,max=160"`
	EnrollmentNumber string `json:"enrollmentNumber" validate:"required"`
	DepartmentID     int64  `json:"departmentId" validate:"required,gt=0"`
	Role             string `json:"role" validate:"omitempty,oneof=student coordinator"`
}

func (h *AdminHandler) CreateStudent(w http.ResponseWriter, r *http.Request) {
	var req adminCreateStudentRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.FailError(w, err)
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.FullName = strings.TrimSpace(req.FullName)
	req.EnrollmentNumber = strings.ToUpper(strings.TrimSpace(req.EnrollmentNumber))
	req.Role = strings.ToLower(strings.TrimSpace(req.Role))

	fields, err := h.validatePayload(&req)
	if err != nil {
		h.fail(w, "validate student payload", err)
		return
	}
	if req.Password != "" {
		if message := authPasswordMessage(req.Password); message != "" {
			fields["password"] = message
		}
	}
	if req.FullName == "" {
		fields["fullName"] = "Full name cannot be blank."
	}
	if req.EnrollmentNumber != "" && !adminEnrollmentPattern.MatchString(req.EnrollmentNumber) {
		fields["enrollmentNumber"] = "Enrollment number must be 4-24 letters, numbers or dashes."
	}
	if len(fields) > 0 {
		httpx.FailError(w, apperr.Validation(fields))
		return
	}

	student, err := h.svc.CreateStudent(r.Context(), services.AdminCreateStudentInput{
		Email:            req.Email,
		Password:         req.Password,
		FullName:         req.FullName,
		EnrollmentNumber: req.EnrollmentNumber,
		DepartmentID:     req.DepartmentID,
		Role:             req.Role,
	})
	if err != nil {
		h.fail(w, "create student", err)
		return
	}
	httpx.Created(w, student)
}

type adminUpdateStudentRequest struct {
	FullName         *string `json:"fullName" validate:"omitempty,min=1,max=160"`
	DepartmentID     *int64  `json:"departmentId" validate:"omitempty,gt=0"`
	EnrollmentNumber *string `json:"enrollmentNumber" validate:"omitempty,min=4,max=24"`
}

func (h *AdminHandler) UpdateStudent(w http.ResponseWriter, r *http.Request) {
	studentID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}

	var req adminUpdateStudentRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.FailError(w, err)
		return
	}
	if req.FullName != nil {
		fullName := strings.TrimSpace(*req.FullName)
		req.FullName = &fullName
	}
	if req.EnrollmentNumber != nil {
		enrollment := strings.ToUpper(strings.TrimSpace(*req.EnrollmentNumber))
		req.EnrollmentNumber = &enrollment
	}

	fields, err := h.validatePayload(&req)
	if err != nil {
		h.fail(w, "validate student payload", err)
		return
	}
	if req.FullName != nil && *req.FullName == "" {
		fields["fullName"] = "Full name cannot be blank."
	}
	if req.EnrollmentNumber != nil && !adminEnrollmentPattern.MatchString(*req.EnrollmentNumber) {
		fields["enrollmentNumber"] = "Enrollment number must be 4-24 letters, numbers or dashes."
	}
	if len(fields) > 0 {
		httpx.FailError(w, apperr.Validation(fields))
		return
	}
	if req.FullName == nil && req.DepartmentID == nil && req.EnrollmentNumber == nil {
		httpx.FailError(w, apperr.BadRequest("Provide at least one field to update."))
		return
	}

	student, err := h.svc.UpdateStudent(r.Context(), studentID, services.AdminUpdateStudentInput{
		FullName:         req.FullName,
		DepartmentID:     req.DepartmentID,
		EnrollmentNumber: req.EnrollmentNumber,
	})
	if err != nil {
		h.fail(w, "update student", err)
		return
	}
	httpx.JSON(w, http.StatusOK, student)
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

type adminCreateDepartmentRequest struct {
	Name string `json:"name" validate:"required,max=120"`
	Code string `json:"code" validate:"required"`
}

func (h *AdminHandler) CreateDepartment(w http.ResponseWriter, r *http.Request) {
	var req adminCreateDepartmentRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.FailError(w, err)
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Code = strings.ToUpper(strings.TrimSpace(req.Code))

	fields, err := h.validatePayload(&req)
	if err != nil {
		h.fail(w, "validate department payload", err)
		return
	}
	if req.Name == "" {
		fields["name"] = "Department name cannot be blank."
	}
	if !adminDepartmentCodeFormat.MatchString(req.Code) {
		fields["code"] = "Code must be 2-8 uppercase letters."
	}
	if len(fields) > 0 {
		httpx.FailError(w, apperr.Validation(fields))
		return
	}

	department, err := h.svc.CreateDepartment(r.Context(), req.Name, req.Code)
	if err != nil {
		h.fail(w, "create department", err)
		return
	}
	httpx.Created(w, department)
}

type adminUpdateDepartmentRequest struct {
	Name *string `json:"name" validate:"omitempty,min=1,max=120"`
	Code *string `json:"code"`
}

func (h *AdminHandler) UpdateDepartment(w http.ResponseWriter, r *http.Request) {
	departmentID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}

	var req adminUpdateDepartmentRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.FailError(w, err)
		return
	}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		req.Name = &name
	}
	if req.Code != nil {
		code := strings.ToUpper(strings.TrimSpace(*req.Code))
		req.Code = &code
	}

	fields, err := h.validatePayload(&req)
	if err != nil {
		h.fail(w, "validate department payload", err)
		return
	}
	if req.Name != nil && *req.Name == "" {
		fields["name"] = "Department name cannot be blank."
	}
	if req.Code != nil && !adminDepartmentCodeFormat.MatchString(*req.Code) {
		fields["code"] = "Code must be 2-8 uppercase letters."
	}
	if len(fields) > 0 {
		httpx.FailError(w, apperr.Validation(fields))
		return
	}
	if req.Name == nil && req.Code == nil {
		httpx.FailError(w, apperr.BadRequest("Provide at least one field to update."))
		return
	}

	department, err := h.svc.UpdateDepartment(r.Context(), departmentID, services.AdminUpdateDepartmentInput{
		Name: req.Name,
		Code: req.Code,
	})
	if err != nil {
		h.fail(w, "update department", err)
		return
	}
	httpx.JSON(w, http.StatusOK, department)
}

func (h *AdminHandler) DeleteDepartment(w http.ResponseWriter, r *http.Request) {
	departmentID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	if err := h.svc.DeleteDepartment(r.Context(), departmentID); err != nil {
		h.fail(w, "delete department", err)
		return
	}
	httpx.NoContent(w)
}

// ---------------------------------------------------------------------------
// Venues
// ---------------------------------------------------------------------------

type adminCreateVenueRequest struct {
	Name     string `json:"name" validate:"required,max=120"`
	Capacity int    `json:"capacity" validate:"required,gt=0"`
	Location string `json:"location" validate:"required,max=160"`
}

func (h *AdminHandler) CreateVenue(w http.ResponseWriter, r *http.Request) {
	var req adminCreateVenueRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.FailError(w, err)
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Location = strings.TrimSpace(req.Location)

	fields, err := h.validatePayload(&req)
	if err != nil {
		h.fail(w, "validate venue payload", err)
		return
	}
	if req.Name == "" {
		fields["name"] = "Venue name cannot be blank."
	}
	if req.Location == "" {
		fields["location"] = "Location cannot be blank."
	}
	if len(fields) > 0 {
		httpx.FailError(w, apperr.Validation(fields))
		return
	}

	venue, err := h.svc.CreateVenue(r.Context(), req.Name, req.Capacity, req.Location)
	if err != nil {
		h.fail(w, "create venue", err)
		return
	}
	httpx.Created(w, venue)
}

type adminUpdateVenueRequest struct {
	Name     *string `json:"name" validate:"omitempty,min=1,max=120"`
	Capacity *int    `json:"capacity" validate:"omitempty,gt=0"`
	Location *string `json:"location" validate:"omitempty,min=1,max=160"`
}

func (h *AdminHandler) UpdateVenue(w http.ResponseWriter, r *http.Request) {
	venueID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}

	var req adminUpdateVenueRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.FailError(w, err)
		return
	}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		req.Name = &name
	}
	if req.Location != nil {
		location := strings.TrimSpace(*req.Location)
		req.Location = &location
	}

	fields, err := h.validatePayload(&req)
	if err != nil {
		h.fail(w, "validate venue payload", err)
		return
	}
	if req.Name != nil && *req.Name == "" {
		fields["name"] = "Venue name cannot be blank."
	}
	if req.Location != nil && *req.Location == "" {
		fields["location"] = "Location cannot be blank."
	}
	if len(fields) > 0 {
		httpx.FailError(w, apperr.Validation(fields))
		return
	}
	if req.Name == nil && req.Capacity == nil && req.Location == nil {
		httpx.FailError(w, apperr.BadRequest("Provide at least one field to update."))
		return
	}

	venue, err := h.svc.UpdateVenue(r.Context(), venueID, services.AdminUpdateVenueInput{
		Name:     req.Name,
		Capacity: req.Capacity,
		Location: req.Location,
	})
	if err != nil {
		h.fail(w, "update venue", err)
		return
	}
	httpx.JSON(w, http.StatusOK, venue)
}

func (h *AdminHandler) DeleteVenue(w http.ResponseWriter, r *http.Request) {
	venueID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	if err := h.svc.DeleteVenue(r.Context(), venueID); err != nil {
		h.fail(w, "delete venue", err)
		return
	}
	httpx.NoContent(w)
}

// ---------------------------------------------------------------------------
// Clubs
// ---------------------------------------------------------------------------

func (h *AdminHandler) ListClubs(w http.ResponseWriter, r *http.Request) {
	page, pageSize, offset := httpx.Pagination(r)

	clubs, total, err := h.svc.ListClubs(r.Context(), services.AdminClubListInput{
		Status: httpx.QueryString(r, "status"),
		Search: httpx.QueryString(r, "search"),
		Limit:  pageSize,
		Offset: offset,
	})
	if err != nil {
		h.fail(w, "list clubs", err)
		return
	}
	httpx.Paginated(w, clubs, page, pageSize, total)
}

type adminCreateClubRequest struct {
	Name        string  `json:"name" validate:"required,max=120"`
	Description string  `json:"description" validate:"max=2000"`
	Status      *string `json:"status" validate:"omitempty,oneof=pending approved rejected inactive"`
}

func (h *AdminHandler) CreateClub(w http.ResponseWriter, r *http.Request) {
	var req adminCreateClubRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.FailError(w, err)
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Description = strings.TrimSpace(req.Description)
	status := ""
	if req.Status != nil {
		status = strings.ToLower(strings.TrimSpace(*req.Status))
		req.Status = &status
	}

	fields, err := h.validatePayload(&req)
	if err != nil {
		h.fail(w, "validate club payload", err)
		return
	}
	if req.Name == "" {
		fields["name"] = "Club name cannot be blank."
	}
	if len(fields) > 0 {
		httpx.FailError(w, apperr.Validation(fields))
		return
	}

	club, err := h.svc.CreateClub(r.Context(), services.AdminCreateClubInput{
		Name:        req.Name,
		Description: req.Description,
		Status:      status,
	})
	if err != nil {
		h.fail(w, "create club", err)
		return
	}
	httpx.Created(w, club)
}

type adminUpdateClubRequest struct {
	Name        *string `json:"name" validate:"omitempty,min=1,max=120"`
	Description *string `json:"description" validate:"omitempty,max=2000"`
	Status      *string `json:"status" validate:"omitempty,oneof=pending approved rejected inactive"`
}

func (h *AdminHandler) UpdateClub(w http.ResponseWriter, r *http.Request) {
	clubID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}

	var req adminUpdateClubRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.FailError(w, err)
		return
	}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		req.Name = &name
	}
	if req.Description != nil {
		description := strings.TrimSpace(*req.Description)
		req.Description = &description
	}
	if req.Status != nil {
		status := strings.ToLower(strings.TrimSpace(*req.Status))
		req.Status = &status
	}

	fields, err := h.validatePayload(&req)
	if err != nil {
		h.fail(w, "validate club payload", err)
		return
	}
	if req.Name != nil && *req.Name == "" {
		fields["name"] = "Club name cannot be blank."
	}
	if len(fields) > 0 {
		httpx.FailError(w, apperr.Validation(fields))
		return
	}
	if req.Name == nil && req.Description == nil && req.Status == nil {
		httpx.FailError(w, apperr.BadRequest("Provide at least one field to update."))
		return
	}

	club, err := h.svc.UpdateClub(r.Context(), clubID, services.AdminUpdateClubInput{
		Name:        req.Name,
		Description: req.Description,
		Status:      req.Status,
	})
	if err != nil {
		h.fail(w, "update club", err)
		return
	}
	httpx.JSON(w, http.StatusOK, club)
}

type adminSetCoordinatorRequest struct {
	StudentID int64 `json:"studentId" validate:"required,gt=0"`
}

func (h *AdminHandler) SetClubCoordinator(w http.ResponseWriter, r *http.Request) {
	clubID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}

	var req adminSetCoordinatorRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.FailError(w, err)
		return
	}
	fields, err := h.validatePayload(&req)
	if err != nil {
		h.fail(w, "validate coordinator payload", err)
		return
	}
	if len(fields) > 0 {
		httpx.FailError(w, apperr.Validation(fields))
		return
	}

	principal := authctx.MustFromRequest(r)
	club, err := h.svc.SetClubCoordinator(r.Context(), clubID, req.StudentID, principal.UserID)
	if err != nil {
		h.fail(w, "set club coordinator", err)
		return
	}
	httpx.JSON(w, http.StatusOK, club)
}

func (h *AdminHandler) DeleteClub(w http.ResponseWriter, r *http.Request) {
	clubID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	if err := h.svc.DeleteClub(r.Context(), clubID); err != nil {
		h.fail(w, "delete club", err)
		return
	}
	httpx.NoContent(w)
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

func (h *AdminHandler) ListEvents(w http.ResponseWriter, r *http.Request) {
	page, pageSize, offset := httpx.Pagination(r)

	events, total, err := h.svc.ListEvents(r.Context(), services.AdminEventListInput{
		Status: httpx.QueryString(r, "status"),
		Search: httpx.QueryString(r, "search"),
		Limit:  pageSize,
		Offset: offset,
	})
	if err != nil {
		h.fail(w, "list events", err)
		return
	}
	httpx.Paginated(w, events, page, pageSize, total)
}

type adminUpdateEventStatusRequest struct {
	Status          string  `json:"status" validate:"required,oneof=draft pending published rejected completed cancelled"`
	RejectionReason *string `json:"rejectionReason" validate:"omitempty,max=1000"`
}

func (h *AdminHandler) UpdateEventStatus(w http.ResponseWriter, r *http.Request) {
	eventID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}

	var req adminUpdateEventStatusRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.FailError(w, err)
		return
	}
	req.Status = strings.ToLower(strings.TrimSpace(req.Status))

	fields, err := h.validatePayload(&req)
	if err != nil {
		h.fail(w, "validate event status payload", err)
		return
	}
	if len(fields) > 0 {
		httpx.FailError(w, apperr.Validation(fields))
		return
	}

	event, err := h.svc.UpdateEventStatus(r.Context(), eventID, services.AdminUpdateEventStatusInput{
		Status:          req.Status,
		RejectionReason: req.RejectionReason,
	})
	if err != nil {
		h.fail(w, "update event status", err)
		return
	}
	httpx.JSON(w, http.StatusOK, event)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// adminQueryID parses an optional positive integer query parameter.
func adminQueryID(r *http.Request, name string) (*int64, error) {
	raw := httpx.QueryString(r, name)
	if raw == "" {
		return nil, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		return nil, apperr.BadRequest("The " + name + " filter must be a positive number.")
	}
	return &value, nil
}

func (h *AdminHandler) fail(w http.ResponseWriter, action string, err error) {
	if _, ok := apperr.As(err); !ok {
		slog.Error("admin handler: "+action, "error", err)
	}
	httpx.FailError(w, err)
}

// validatePayload returns camelCase field errors keyed by JSON field names. The
// map is always non-nil so callers can add manual field errors safely.
func (h *AdminHandler) validatePayload(payload any) (map[string]string, error) {
	fields := make(map[string]string)
	err := h.validate.Struct(payload)
	if err == nil {
		return fields, nil
	}
	var fieldErrors validator.ValidationErrors
	if !errors.As(err, &fieldErrors) {
		return nil, err
	}
	for _, fieldErr := range fieldErrors {
		fields[adminJSONFieldName(payload, fieldErr)] = adminFieldMessage(fieldErr)
	}
	return fields, nil
}

func adminJSONFieldName(payload any, fieldErr validator.FieldError) string {
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

func adminFieldMessage(fieldErr validator.FieldError) string {
	switch fieldErr.Tag() {
	case "required":
		return "This field is required."
	case "email":
		return "Enter a valid email address."
	case "min":
		if fieldErr.Kind() == reflect.String {
			return "Must be at least " + fieldErr.Param() + " characters."
		}
		return "Must be at least " + fieldErr.Param() + "."
	case "max":
		if fieldErr.Kind() == reflect.String {
			return "Must be at most " + fieldErr.Param() + " characters."
		}
		return "Must be at most " + fieldErr.Param() + "."
	case "gt":
		return "Must be greater than " + fieldErr.Param() + "."
	case "oneof":
		return "Choose one of: " + fieldErr.Param() + "."
	default:
		return "This value is invalid."
	}
}
