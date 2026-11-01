package handlers

import (
	"log/slog"
	"net/http"

	"github.com/campusconnect/backend/internal/apperr"
	"github.com/campusconnect/backend/internal/authctx"
	"github.com/campusconnect/backend/internal/httpx"
	"github.com/campusconnect/backend/internal/services"
	"github.com/go-playground/validator/v10"
)

// RegistrationHandler exposes student self-service registrations and the
// admin/coordinator attendance and certificate endpoints.
type RegistrationHandler struct {
	svc      *services.RegistrationService
	validate *validator.Validate
}

func NewRegistrationHandler(svc *services.RegistrationService, validate *validator.Validate) *RegistrationHandler {
	return &RegistrationHandler{svc: svc, validate: validate}
}

type registrationAttendanceRequest struct {
	Status string `json:"status" validate:"required,oneof=present absent"`
}

func (h *RegistrationHandler) Register(w http.ResponseWriter, r *http.Request) {
	eventID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	principal := authctx.MustFromRequest(r)
	registration, err := h.svc.Register(r.Context(), principal, eventID)
	if err != nil {
		h.fail(w, "register for event", err)
		return
	}
	httpx.Created(w, registration)
}

func (h *RegistrationHandler) MarkAttendance(w http.ResponseWriter, r *http.Request) {
	registrationID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	var req registrationAttendanceRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.FailError(w, err)
		return
	}
	fields, err := eventValidatePayload(h.validate, &req)
	if err != nil {
		h.fail(w, "validate attendance payload", err)
		return
	}
	if len(fields) > 0 {
		httpx.FailError(w, apperr.Validation(fields))
		return
	}

	principal := authctx.MustFromRequest(r)
	attendance, err := h.svc.MarkAttendance(r.Context(), principal, registrationID, req.Status)
	if err != nil {
		h.fail(w, "mark registration attendance", err)
		return
	}
	httpx.JSON(w, http.StatusOK, attendance)
}

func (h *RegistrationHandler) Delete(w http.ResponseWriter, r *http.Request) {
	registrationID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	principal := authctx.MustFromRequest(r)
	if err := h.svc.CancelRegistration(r.Context(), principal, registrationID); err != nil {
		h.fail(w, "cancel registration", err)
		return
	}
	httpx.NoContent(w)
}

func (h *RegistrationHandler) StudentCertificates(w http.ResponseWriter, r *http.Request) {
	studentID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	principal := authctx.MustFromRequest(r)
	certificates, err := h.svc.StudentCertificates(r.Context(), principal, studentID)
	if err != nil {
		h.fail(w, "list student certificates", err)
		return
	}
	httpx.JSON(w, http.StatusOK, certificates)
}

func (h *RegistrationHandler) MyRegistrations(w http.ResponseWriter, r *http.Request) {
	page, pageSize, offset := httpx.Pagination(r)
	principal := authctx.MustFromRequest(r)
	registrations, total, err := h.svc.MyRegistrations(
		r.Context(),
		principal,
		httpx.QueryString(r, "status"),
		pageSize,
		offset,
	)
	if err != nil {
		h.fail(w, "list my registrations", err)
		return
	}
	httpx.Paginated(w, registrations, page, pageSize, total)
}

func (h *RegistrationHandler) MyCertificates(w http.ResponseWriter, r *http.Request) {
	principal := authctx.MustFromRequest(r)
	certificates, err := h.svc.MyCertificates(r.Context(), principal)
	if err != nil {
		h.fail(w, "list my certificates", err)
		return
	}
	httpx.JSON(w, http.StatusOK, certificates)
}

func (h *RegistrationHandler) fail(w http.ResponseWriter, action string, err error) {
	if _, ok := apperr.As(err); !ok {
		slog.Error("registration handler: "+action, "error", err)
		httpx.FailError(w, apperr.Internal(err))
		return
	}
	httpx.FailError(w, err)
}
