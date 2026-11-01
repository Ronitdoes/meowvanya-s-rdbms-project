package server

import (
	"github.com/campusconnect/backend/internal/handlers"
	"github.com/campusconnect/backend/internal/repositories"
	"github.com/campusconnect/backend/internal/services"
	"github.com/go-chi/chi/v5"
)

func newAuthHandler(deps Deps) *handlers.AuthHandler {
	users := repositories.NewUserRepository(deps.DB)
	authService := services.NewAuthService(users)
	return handlers.NewAuthHandler(authService, deps.Auth, deps.Config, deps.Validator)
}

func registerAuthRoutes(api chi.Router, deps Deps) {
	h := newAuthHandler(deps)
	api.Post("/auth/register", h.Register)
	api.Post("/auth/login", h.Login)
}

func registerAuthProtectedRoutes(r chi.Router, deps Deps) {
	h := newAuthHandler(deps)
	r.Get("/auth/me", h.Me)
	r.Patch("/auth/me", h.UpdateMe)
	r.Post("/auth/change-password", h.ChangePassword)
	r.Post("/auth/logout", h.Logout)
}
