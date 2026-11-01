package server

import (
	"github.com/campusconnect/backend/internal/handlers"
	appmw "github.com/campusconnect/backend/internal/middleware"
	"github.com/campusconnect/backend/internal/repositories"
	"github.com/campusconnect/backend/internal/services"
	"github.com/go-chi/chi/v5"
)

func newEventHandlers(deps Deps) (*handlers.EventHandler, *handlers.RegistrationHandler) {
	events := repositories.NewEventRepository(deps.DB)
	registrations := repositories.NewRegistrationRepository(deps.DB)
	authz := repositories.NewAuthz(deps.DB)

	eventService := services.NewEventService(events, registrations, authz)
	registrationService := services.NewRegistrationService(events, registrations, authz)

	return handlers.NewEventHandler(eventService, deps.Validator),
		handlers.NewRegistrationHandler(registrationService, deps.Validator)
}

// registerEventPublicRoutes mounts public event discovery. Optional auth is
// applied so authenticated students also receive myRegistration.
func registerEventPublicRoutes(api chi.Router, deps Deps) {
	eventHandler, _ := newEventHandlers(deps)
	optionalAuth := appmw.NewAuth(deps.Auth, deps.DB).Optional

	api.Group(func(public chi.Router) {
		public.Use(optionalAuth)
		public.Get("/events", eventHandler.List)
		public.Get("/events/{id}", eventHandler.Get)
	})
}

// registerEventProtectedRoutes mounts event management, registrations,
// attendance, feedback, certificates and student self-service routes.
func registerEventProtectedRoutes(r chi.Router, deps Deps) {
	eventHandler, registrationHandler := newEventHandlers(deps)

	r.Post("/events", eventHandler.Create)
	r.Patch("/events/{id}", eventHandler.Update)
	r.Delete("/events/{id}", eventHandler.Delete)

	r.Post("/events/{id}/register", registrationHandler.Register)
	r.Get("/events/{id}/registrations", eventHandler.ListRegistrations)
	r.Get("/events/{id}/feedback", eventHandler.ListFeedback)
	r.Post("/events/{id}/feedback", eventHandler.CreateFeedback)
	r.Get("/events/{id}/stats", eventHandler.Stats)
	r.Post("/events/{id}/attendance", eventHandler.MarkAttendance)
	r.Post("/events/{id}/certificates", eventHandler.IssueCertificates)

	r.Post("/registrations/{id}/attendance", registrationHandler.MarkAttendance)
	r.Delete("/registrations/{id}", registrationHandler.Delete)

	r.Get("/students/{id}/certificates", registrationHandler.StudentCertificates)
	r.Get("/me/registrations", registrationHandler.MyRegistrations)
	r.Get("/me/certificates", registrationHandler.MyCertificates)
}
