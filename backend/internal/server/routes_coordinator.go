package server

import (
	appmw "github.com/campusconnect/backend/internal/middleware"
	"github.com/go-chi/chi/v5"
)

// registerCoordinatorProtectedRoutes mounts coordinator-only dashboards and
// managed-event views.
func registerCoordinatorProtectedRoutes(r chi.Router, deps Deps) {
	eventHandler, _ := newEventHandlers(deps)

	r.Group(func(coordinator chi.Router) {
		coordinator.Use(appmw.RequireRole("coordinator"))
		coordinator.Get("/coordinator/dashboard", eventHandler.Dashboard)
		coordinator.Get("/coordinator/events", eventHandler.ListManaged)
		coordinator.Get("/coordinator/events/{id}", eventHandler.GetManaged)
	})
}
