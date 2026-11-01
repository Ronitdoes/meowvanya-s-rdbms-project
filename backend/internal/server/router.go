package server

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/campusconnect/backend/internal/auth"
	"github.com/campusconnect/backend/internal/config"
	appmw "github.com/campusconnect/backend/internal/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/go-playground/validator/v10"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Deps struct {
	DB        *pgxpool.Pool
	Config    config.Config
	Auth      *auth.Manager
	Validator *validator.Validate
}

func NewRouter(deps Deps) http.Handler {
	r := chi.NewRouter()
	r.Use(appmw.RequestID)
	r.Use(appmw.RequestLogger)
	r.Use(appmw.Recoverer)
	if deps.Config.FrontendURL != "" {
		r.Use(appmw.CORS(deps.Config.FrontendURL))
	}

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		status := http.StatusOK
		dbStatus := "up"
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		if err := deps.DB.Ping(ctx); err != nil {
			status = http.StatusServiceUnavailable
			dbStatus = "down"
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":   http.StatusText(status),
			"database": dbStatus,
			"time":     time.Now().UTC(),
		})
	})

	authenticator := appmw.NewAuth(deps.Auth, deps.DB)

	r.Route("/api/v1", func(api chi.Router) {
		// Public endpoints: authentication, directory data and event discovery.
		registerAuthRoutes(api, deps)
		registerDirectoryPublicRoutes(api, deps)
		registerClubPublicRoutes(api, deps)
		registerEventPublicRoutes(api, deps)

		api.Group(func(protected chi.Router) {
			protected.Use(authenticator.Require)
			protected.Use(appmw.RequireCSRF)

			registerAuthProtectedRoutes(protected, deps)
			registerDirectoryProtectedRoutes(protected, deps)
			registerClubProtectedRoutes(protected, deps)
			registerEventProtectedRoutes(protected, deps)
			registerMeProtectedRoutes(protected, deps)
			registerCoordinatorProtectedRoutes(protected, deps)
			registerAdminProtectedRoutes(protected, deps)
		})
	})

	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]string{"code": "not_found", "message": "The requested endpoint does not exist."},
		})
	})

	return r
}
