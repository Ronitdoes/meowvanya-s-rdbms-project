package apperr

import (
	"errors"
	"fmt"
	"net/http"
)

// Error is a transport-safe application error. Internal causes are never sent
// to clients; handlers map Code/Message/Fields directly to JSON.
type Error struct {
	Status  int               `json:"-"`
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
	cause   error
}

func (e *Error) Error() string {
	if e.cause != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.cause)
	}
	return e.Message
}

func (e *Error) Unwrap() error { return e.cause }

func New(status int, code, message string) *Error {
	return &Error{Status: status, Code: code, Message: message}
}

func WithCause(err error, status int, code, message string) *Error {
	return &Error{Status: status, Code: code, Message: message, cause: err}
}

func BadRequest(message string) *Error {
	return New(http.StatusBadRequest, "bad_request", message)
}

func Unauthorized(message string) *Error {
	return New(http.StatusUnauthorized, "unauthorized", message)
}

func Forbidden(message string) *Error {
	return New(http.StatusForbidden, "forbidden", message)
}

func NotFound(message string) *Error {
	return New(http.StatusNotFound, "not_found", message)
}

func Conflict(message string) *Error {
	return New(http.StatusConflict, "conflict", message)
}

func Internal(err error) *Error {
	return WithCause(err, http.StatusInternalServerError, "internal_error", "Something went wrong. Please try again.")
}

func Validation(fields map[string]string) *Error {
	return &Error{
		Status:  http.StatusUnprocessableEntity,
		Code:    "validation_error",
		Message: "Please correct the highlighted fields.",
		Fields:  fields,
	}
}

func Unprocessable(message string) *Error {
	return New(http.StatusUnprocessableEntity, "unprocessable", message)
}

func As(err error) (*Error, bool) {
	var appErr *Error
	if errors.As(err, &appErr) {
		return appErr, true
	}
	return nil, false
}
