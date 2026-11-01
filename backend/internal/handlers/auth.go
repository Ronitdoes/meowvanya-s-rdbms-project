package handlers

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"reflect"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/campusconnect/backend/internal/apperr"
	"github.com/campusconnect/backend/internal/auth"
	"github.com/campusconnect/backend/internal/authctx"
	"github.com/campusconnect/backend/internal/config"
	"github.com/campusconnect/backend/internal/httpx"
	"github.com/campusconnect/backend/internal/models"
	"github.com/campusconnect/backend/internal/services"
	"github.com/go-playground/validator/v10"
)

// AuthHandler exposes registration, session and self-service account routes.
type AuthHandler struct {
	svc      *services.AuthService
	manager  *auth.Manager
	cfg      config.Config
	validate *validator.Validate
}

func NewAuthHandler(svc *services.AuthService, manager *auth.Manager, cfg config.Config, validate *validator.Validate) *AuthHandler {
	return &AuthHandler{svc: svc, manager: manager, cfg: cfg, validate: validate}
}

type authRegisterRequest struct {
	Email            string `json:"email" validate:"required,email"`
	Password         string `json:"password" validate:"required,min=8"`
	FullName         string `json:"fullName" validate:"required"`
	EnrollmentNumber string `json:"enrollmentNumber" validate:"required"`
	DepartmentID     int64  `json:"departmentId" validate:"required,gt=0"`
}

type authLoginRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required"`
}

type authUpdateProfileRequest struct {
	FullName     *string `json:"fullName" validate:"omitempty,min=1"`
	DepartmentID *int64  `json:"departmentId" validate:"omitempty,gt=0"`
}

type authChangePasswordRequest struct {
	CurrentPassword string `json:"currentPassword" validate:"required"`
	NewPassword     string `json:"newPassword" validate:"required,min=8"`
}

var authEnrollmentPattern = regexp.MustCompile(`^[A-Za-z0-9-]{4,24}$`)

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req authRegisterRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.FailError(w, err)
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.FullName = strings.TrimSpace(req.FullName)
	req.EnrollmentNumber = strings.ToUpper(strings.TrimSpace(req.EnrollmentNumber))

	fields, err := h.validatePayload(&req)
	if err != nil {
		h.failInternal(w, "validate registration payload", err)
		return
	}
	if req.Password != "" {
		if message := authPasswordMessage(req.Password); message != "" {
			fields["password"] = message
		}
	}
	if req.EnrollmentNumber != "" && !authEnrollmentPattern.MatchString(req.EnrollmentNumber) {
		fields["enrollmentNumber"] = "Enrollment number must be 4-24 letters, numbers or dashes."
	}
	if len(fields) > 0 {
		httpx.FailError(w, apperr.Validation(fields))
		return
	}

	user, err := h.svc.Register(r.Context(), services.RegisterInput{
		Email:            req.Email,
		Password:         req.Password,
		FullName:         req.FullName,
		EnrollmentNumber: req.EnrollmentNumber,
		DepartmentID:     req.DepartmentID,
	})
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	if err := h.startSession(w, user); err != nil {
		h.failInternal(w, "start registration session", err)
		return
	}
	httpx.Created(w, user)
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req authLoginRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.FailError(w, err)
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))

	fields, err := h.validatePayload(&req)
	if err != nil {
		h.failInternal(w, "validate login payload", err)
		return
	}
	if len(fields) > 0 {
		httpx.FailError(w, apperr.Validation(fields))
		return
	}

	user, err := h.svc.Login(r.Context(), services.LoginInput{
		Email:    req.Email,
		Password: req.Password,
	})
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	if err := h.startSession(w, user); err != nil {
		h.failInternal(w, "start login session", err)
		return
	}
	httpx.JSON(w, http.StatusOK, user)
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	principal := authctx.MustFromRequest(r)
	user, err := h.svc.Session(r.Context(), principal.UserID)
	if err != nil {
		httpx.FailError(w, err)
		return
	}

	// Refresh CSRF only when it is absent; rotating on every read would break
	// other tabs holding the previous token.
	if cookie, err := r.Cookie(auth.CSRFCookieName); err != nil || cookie.Value == "" {
		csrfToken, err := auth.NewCSRFToken()
		if err != nil {
			h.failInternal(w, "issue csrf token", err)
			return
		}
		h.setCSRFCookie(w, csrfToken)
	}
	httpx.JSON(w, http.StatusOK, user)
}

func (h *AuthHandler) UpdateMe(w http.ResponseWriter, r *http.Request) {
	var req authUpdateProfileRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.FailError(w, err)
		return
	}
	if req.FullName == nil && req.DepartmentID == nil {
		httpx.FailError(w, apperr.BadRequest("Provide at least one field to update."))
		return
	}

	fields, err := h.validatePayload(&req)
	if err != nil {
		h.failInternal(w, "validate profile payload", err)
		return
	}
	if req.FullName != nil {
		fullName := strings.TrimSpace(*req.FullName)
		if fullName == "" {
			fields["fullName"] = "Full name cannot be blank."
		} else {
			req.FullName = &fullName
		}
	}
	if len(fields) > 0 {
		httpx.FailError(w, apperr.Validation(fields))
		return
	}

	principal := authctx.MustFromRequest(r)
	user, err := h.svc.UpdateProfile(r.Context(), principal, services.UpdateProfileInput{
		FullName:     req.FullName,
		DepartmentID: req.DepartmentID,
	})
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	httpx.JSON(w, http.StatusOK, user)
}

func (h *AuthHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	var req authChangePasswordRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.FailError(w, err)
		return
	}

	fields, err := h.validatePayload(&req)
	if err != nil {
		h.failInternal(w, "validate password payload", err)
		return
	}
	if req.NewPassword != "" {
		if message := authPasswordMessage(req.NewPassword); message != "" {
			fields["newPassword"] = message
		}
	}
	if len(fields) > 0 {
		httpx.FailError(w, apperr.Validation(fields))
		return
	}

	principal := authctx.MustFromRequest(r)
	if err := h.svc.ChangePassword(r.Context(), principal.UserID, services.ChangePasswordInput{
		CurrentPassword: req.CurrentPassword,
		NewPassword:     req.NewPassword,
	}); err != nil {
		httpx.FailError(w, err)
		return
	}
	httpx.NoContent(w)
}

func (h *AuthHandler) Logout(w http.ResponseWriter, _ *http.Request) {
	h.clearAuthCookies(w)
	httpx.NoContent(w)
}

func (h *AuthHandler) startSession(w http.ResponseWriter, user models.SessionUser) error {
	token, _, err := h.manager.Issue(user.UserID, user.Role)
	if err != nil {
		return err
	}
	csrfToken, err := auth.NewCSRFToken()
	if err != nil {
		return err
	}
	h.setSessionCookie(w, token)
	h.setCSRFCookie(w, csrfToken)
	return nil
}

func (h *AuthHandler) setSessionCookie(w http.ResponseWriter, value string) {
	http.SetCookie(w, h.authCookie(auth.SessionCookieName, value, true, h.sessionMaxAge()))
}

func (h *AuthHandler) setCSRFCookie(w http.ResponseWriter, value string) {
	http.SetCookie(w, h.authCookie(auth.CSRFCookieName, value, false, h.sessionMaxAge()))
}

func (h *AuthHandler) clearAuthCookies(w http.ResponseWriter) {
	http.SetCookie(w, h.authCookie(auth.SessionCookieName, "", true, -1))
	http.SetCookie(w, h.authCookie(auth.CSRFCookieName, "", false, -1))
}

func (h *AuthHandler) authCookie(name, value string, httpOnly bool, maxAge int) *http.Cookie {
	secure, sameSite := h.cookiePolicy()
	cookie := &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: httpOnly,
		Secure:   secure,
		SameSite: sameSite,
	}
	if h.cfg.CookieDomain != "" {
		cookie.Domain = h.cfg.CookieDomain
	}
	return cookie
}

func (h *AuthHandler) sessionMaxAge() int {
	return int(h.cfg.JWTTTL / time.Second)
}

// cookiePolicy maps configuration to cookie flags. SameSite=None is only valid
// on secure cookies, so it forces Secure regardless of the base setting.
func (h *AuthHandler) cookiePolicy() (secure bool, sameSite http.SameSite) {
	secure = h.cfg.SecureCookies
	switch h.cfg.CookieSameSite {
	case "strict":
		return secure, http.SameSiteStrictMode
	case "none":
		return true, http.SameSiteNoneMode
	default:
		return secure, http.SameSiteLaxMode
	}
}

func (h *AuthHandler) failInternal(w http.ResponseWriter, action string, err error) {
	slog.Error("auth handler: "+action, "error", err)
	httpx.FailError(w, apperr.Internal(err))
}

func (h *AuthHandler) validatePayload(payload any) (map[string]string, error) {
	err := h.validate.Struct(payload)
	if err == nil {
		return nil, nil
	}
	var fieldErrors validator.ValidationErrors
	if !errors.As(err, &fieldErrors) {
		return nil, err
	}
	return authValidationFields(payload, fieldErrors), nil
}

// authValidationFields converts validator errors into field messages keyed by
// the camelCase JSON field names used by the API.
func authValidationFields(payload any, errs validator.ValidationErrors) map[string]string {
	fields := make(map[string]string, len(errs))
	for _, fieldErr := range errs {
		fields[authFieldName(payload, fieldErr)] = authFieldMessage(fieldErr)
	}
	return fields
}

func authFieldName(payload any, fieldErr validator.FieldError) string {
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

func authFieldMessage(fieldErr validator.FieldError) string {
	switch fieldErr.Tag() {
	case "required":
		return "This field is required."
	case "email":
		return "Enter a valid email address."
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
	default:
		return "This value is invalid."
	}
}

func authPasswordMessage(password string) string {
	if utf8.RuneCountInString(password) < 8 {
		return "Password must be at least 8 characters."
	}
	var hasLetter, hasDigit bool
	for _, r := range password {
		switch {
		case unicode.IsLetter(r):
			hasLetter = true
		case unicode.IsDigit(r):
			hasDigit = true
		}
	}
	if !hasLetter || !hasDigit {
		return "Password must include at least one letter and one number."
	}
	return ""
}
