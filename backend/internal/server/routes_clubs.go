package server

import (
	"github.com/campusconnect/backend/internal/handlers"
	"github.com/campusconnect/backend/internal/repositories"
	"github.com/campusconnect/backend/internal/services"
	"github.com/go-chi/chi/v5"
)

func newClubHandler(deps Deps) *handlers.ClubHandler {
	clubs := repositories.NewClubRepository(deps.DB)
	authz := repositories.NewAuthz(deps.DB)
	return handlers.NewClubHandler(services.NewClubService(clubs, authz))
}

func registerClubPublicRoutes(api chi.Router, deps Deps) {
	h := newClubHandler(deps)
	api.Get("/clubs", h.ListClubs)
	api.Get("/clubs/{id}", h.GetClub)
}

func registerClubProtectedRoutes(r chi.Router, deps Deps) {
	h := newClubHandler(deps)
	r.Post("/clubs/{id}/join", h.JoinClub)
	r.Get("/clubs/{id}/members", h.ListMembers)
	r.Patch("/clubs/{id}/members/{membershipId}", h.DecideMember)
	r.Patch("/clubs/{id}/members/{membershipId}/role", h.UpdateMemberRole)
	r.Delete("/clubs/{id}/members/{membershipId}", h.RemoveMember)
}
