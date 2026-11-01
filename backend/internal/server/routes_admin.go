package server

import (
	"github.com/campusconnect/backend/internal/handlers"
	"github.com/campusconnect/backend/internal/middleware"
	"github.com/campusconnect/backend/internal/repositories"
	"github.com/campusconnect/backend/internal/services"
	"github.com/go-chi/chi/v5"
)

func newAdminHandler(deps Deps) *handlers.AdminHandler {
	repo := repositories.NewAdminRepository(deps.DB)
	svc := services.NewAdminService(repo)
	return handlers.NewAdminHandler(svc, deps.Validator)
}

// registerDirectoryPublicRoutes exposes the unauthenticated reference data used
// by sign-up forms and event creation.
func registerDirectoryPublicRoutes(api chi.Router, deps Deps) {
	h := newAdminHandler(deps)
	api.Get("/departments", h.ListDepartments)
	api.Get("/venues", h.ListVenues)
}

// registerDirectoryProtectedRoutes is intentionally empty: the directory has no
// authenticated-only endpoints yet. Student certificate access belongs to the
// clubs/students slice.
func registerDirectoryProtectedRoutes(_ chi.Router, _ Deps) {}

// registerAdminProtectedRoutes mounts the admin surface behind the admin role.
func registerAdminProtectedRoutes(r chi.Router, deps Deps) {
	h := newAdminHandler(deps)

	r.Group(func(admin chi.Router) {
		admin.Use(middleware.RequireRole("admin"))

		admin.Get("/admin/dashboard", h.Dashboard)

		admin.Get("/admin/users", h.ListUsers)
		admin.Patch("/admin/users/{id}", h.UpdateUser)

		admin.Get("/admin/students", h.ListStudents)
		admin.Post("/admin/students", h.CreateStudent)
		admin.Patch("/admin/students/{id}", h.UpdateStudent)

		admin.Post("/admin/departments", h.CreateDepartment)
		admin.Patch("/admin/departments/{id}", h.UpdateDepartment)
		admin.Delete("/admin/departments/{id}", h.DeleteDepartment)

		admin.Post("/admin/venues", h.CreateVenue)
		admin.Patch("/admin/venues/{id}", h.UpdateVenue)
		admin.Delete("/admin/venues/{id}", h.DeleteVenue)

		admin.Get("/admin/clubs", h.ListClubs)
		admin.Post("/admin/clubs", h.CreateClub)
		admin.Patch("/admin/clubs/{id}", h.UpdateClub)
		admin.Post("/admin/clubs/{id}/coordinator", h.SetClubCoordinator)
		admin.Delete("/admin/clubs/{id}", h.DeleteClub)

		admin.Get("/admin/events", h.ListEvents)
		admin.Patch("/admin/events/{id}/status", h.UpdateEventStatus)
	})
}
