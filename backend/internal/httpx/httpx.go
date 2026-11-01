package httpx

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/campusconnect/backend/internal/apperr"
	"github.com/go-chi/chi/v5"
)

const maxBodyBytes = 1 << 20 // 1 MiB

type Meta struct {
	Page       int `json:"page"`
	PageSize   int `json:"pageSize"`
	Total      int `json:"total"`
	TotalPages int `json:"totalPages"`
}

type envelope struct {
	Data any   `json:"data"`
	Meta *Meta `json:"meta,omitempty"`
}

type errorEnvelope struct {
	Error *apperr.Error `json:"error"`
}

func JSON(w http.ResponseWriter, status int, data any) {
	writeJSON(w, status, envelope{Data: data})
}

func Paginated(w http.ResponseWriter, data any, page, pageSize, total int) {
	pages := 0
	if pageSize > 0 {
		pages = int(math.Ceil(float64(total) / float64(pageSize)))
	}
	writeJSON(w, http.StatusOK, envelope{
		Data: data,
		Meta: &Meta{Page: page, PageSize: pageSize, Total: total, TotalPages: pages},
	})
}

func Created(w http.ResponseWriter, data any) {
	JSON(w, http.StatusCreated, data)
}

func NoContent(w http.ResponseWriter) {
	w.WriteHeader(http.StatusNoContent)
}

func Fail(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorEnvelope{Error: &apperr.Error{Status: status, Code: code, Message: message}})
}

func FailError(w http.ResponseWriter, err error) {
	if appErr, ok := apperr.As(err); ok {
		code := appErr.Code
		if code == "" {
			code = http.StatusText(appErr.Status)
		}
		writeJSON(w, appErr.Status, errorEnvelope{Error: appErr})
		return
	}
	// Unexpected errors are logged by the handler/middleware but never leaked.
	writeJSON(w, http.StatusInternalServerError, errorEnvelope{
		Error: &apperr.Error{
			Status:  http.StatusInternalServerError,
			Code:    "internal_error",
			Message: "Something went wrong. Please try again.",
		},
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if status == http.StatusNoContent {
		return
	}
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		// The response is already committed; nothing useful can be done here.
		return
	}
}

// Decode reads a single JSON object, rejecting unknown fields and trailing data.
func Decode(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var syntaxErr *json.SyntaxError
		var typeErr *json.UnmarshalTypeError
		switch {
		case errors.As(err, &syntaxErr):
			return apperr.BadRequest("The request body contains malformed JSON.")
		case errors.As(err, &typeErr):
			return apperr.BadRequest(fmt.Sprintf("Field %q has the wrong type.", typeErr.Field))
		case errors.Is(err, io.EOF):
			return apperr.BadRequest("The request body is empty.")
		case strings.HasPrefix(err.Error(), "json: unknown field "):
			return apperr.BadRequest("The request body contains an unknown field.")
		default:
			return apperr.BadRequest("The request body could not be read.")
		}
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return apperr.BadRequest("The request body must contain a single JSON object.")
	}
	return nil
}

func PathInt64(r *http.Request, name string) (int64, error) {
	raw := chi.URLParam(r, name)
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return 0, apperr.BadRequest("Invalid " + name + ".")
	}
	return id, nil
}

// Pagination returns validated page/pageSize and the SQL offset.
func Pagination(r *http.Request) (page, pageSize, offset int) {
	page = queryInt(r, "page", 1)
	pageSize = queryInt(r, "pageSize", 12)
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 12
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return page, pageSize, (page - 1) * pageSize
}

func QueryInt(r *http.Request, name string, fallback int) int {
	return queryInt(r, name, fallback)
}

func queryInt(r *http.Request, name string, fallback int) int {
	raw := strings.TrimSpace(r.URL.Query().Get(name))
	if raw == "" {
		return fallback
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return v
}

func QueryBool(r *http.Request, name string) bool {
	raw := strings.TrimSpace(r.URL.Query().Get(name))
	return raw == "true" || raw == "1"
}

func QueryString(r *http.Request, name string) string {
	return strings.TrimSpace(r.URL.Query().Get(name))
}

func TotalPages(total, pageSize int) int {
	if pageSize <= 0 {
		return 0
	}
	return int(math.Ceil(float64(total) / float64(pageSize)))
}
