package server

import (
	"github.com/go-chi/chi/v5"
)

// registerMeProtectedRoutes registers the student self-service endpoints owned
// by the clubs slice.
func registerMeProtectedRoutes(r chi.Router, deps Deps) {
	h := newClubHandler(deps)
	r.Get("/me/memberships", h.MyMemberships)
	r.Get("/me/dashboard", h.MyDashboard)
	r.Get("/me/coordinated-clubs", h.MyCoordinatedClubs)
}
