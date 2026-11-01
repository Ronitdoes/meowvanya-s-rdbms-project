package middleware

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/campusconnect/backend/internal/auth"
	"github.com/campusconnect/backend/internal/authctx"
	"github.com/campusconnect/backend/internal/httpx"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Auth struct {
	manager *auth.Manager
	db      *pgxpool.Pool
}

func NewAuth(manager *auth.Manager, db *pgxpool.Pool) *Auth {
	return &Auth{manager: manager, db: db}
}

func (a *Auth) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		principal, err := a.authenticate(r)
		if err != nil {
			httpx.Fail(w, http.StatusUnauthorized, "unauthorized", "Please sign in to continue.")
			return
		}
		next.ServeHTTP(w, r.WithContext(authctx.WithPrincipal(r.Context(), principal)))
	})
}

func (a *Auth) Optional(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if principal, err := a.authenticate(r); err == nil {
			r = r.WithContext(authctx.WithPrincipal(r.Context(), principal))
		}
		next.ServeHTTP(w, r)
	})
}

func (a *Auth) authenticate(r *http.Request) (authctx.Principal, error) {
	raw := bearerToken(r)
	if raw == "" {
		if cookie, err := r.Cookie(auth.SessionCookieName); err == nil {
			raw = cookie.Value
		}
	}
	if raw == "" {
		return authctx.Principal{}, errors.New("missing token")
	}

	userID, _, err := a.manager.Parse(raw)
	if err != nil {
		return authctx.Principal{}, err
	}

	// The database is the source of truth for role and active status, so a
	// deactivated account or changed role takes effect before token expiry.
	var p authctx.Principal
	var isActive bool
	err = a.db.QueryRow(r.Context(), `
		SELECT u.user_id, u.email, u.role, u.is_active, s.student_id
		FROM users u
		LEFT JOIN students s ON s.user_id = u.user_id
		WHERE u.user_id = $1
	`, userID).Scan(&p.UserID, &p.Email, &p.Role, &isActive, &p.StudentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return authctx.Principal{}, errors.New("user not found")
		}
		slog.Error("auth lookup failed", "error", err)
		return authctx.Principal{}, err
	}
	if !isActive {
		return authctx.Principal{}, errors.New("account disabled")
	}
	return p, nil
}

func bearerToken(r *http.Request) string {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if header == "" {
		return ""
	}
	parts := strings.SplitN(header, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

// RequireRole must be mounted after Auth.Require.
func RequireRole(roles ...string) func(http.Handler) http.Handler {
	allowed := make(map[string]struct{}, len(roles))
	for _, role := range roles {
		allowed[role] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			principal, ok := authctx.FromContext(r.Context())
			if !ok {
				httpx.Fail(w, http.StatusUnauthorized, "unauthorized", "Please sign in to continue.")
				return
			}
			if _, ok := allowed[principal.Role]; !ok {
				httpx.Fail(w, http.StatusForbidden, "forbidden", "You do not have permission to perform this action.")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireCSRF implements the double-submit cookie pattern for cookie-based
// sessions. Bearer-token clients are exempt because browsers never attach those
// automatically.
func RequireCSRF(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next.ServeHTTP(w, r)
			return
		}
		if bearerToken(r) != "" {
			next.ServeHTTP(w, r)
			return
		}
		cookie, err := r.Cookie(auth.CSRFCookieName)
		header := r.Header.Get(auth.CSRFHeaderName)
		if err != nil || cookie.Value == "" || header == "" || !constantTimeEqual(cookie.Value, header) {
			httpx.Fail(w, http.StatusForbidden, "csrf_failed", "The security token is missing or invalid. Refresh the page and try again.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func constantTimeEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	var diff byte
	for i := 0; i < len(a); i++ {
		diff |= a[i] ^ b[i]
	}
	return diff == 0
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(status int) {
	s.status = status
	s.ResponseWriter.WriteHeader(status)
}

func RequestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		slog.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration_ms", time.Since(start).Milliseconds(),
			"request_id", GetRequestID(r.Context()),
		)
	})
}

type requestIDKeyType struct{}

var requestIDKey requestIDKeyType

func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey, id)
}

func GetRequestID(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey).(string)
	return id
}

func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-Id")
		if id == "" {
			id = time.Now().UTC().Format("20060102T150405.000000000")
		}
		w.Header().Set("X-Request-Id", id)
		next.ServeHTTP(w, r.WithContext(WithRequestID(r.Context(), id)))
	})
}

func Recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("panic recovered", "panic", rec, "path", r.URL.Path)
				httpx.Fail(w, http.StatusInternalServerError, "internal_error", "Something went wrong. Please try again.")
			}
		}()
		next.ServeHTTP(w, r)
	})
}
