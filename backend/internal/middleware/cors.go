package middleware

import (
	"net/http"
	"strings"

	"github.com/go-chi/cors"
)

func CORS(frontendURLs string) func(http.Handler) http.Handler {
	origins := make([]string, 0, 4)
	for _, origin := range strings.Split(frontendURLs, ",") {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			origins = append(origins, trimmed)
		}
	}
	return cors.Handler(cors.Options{
		AllowedOrigins:   origins,
		AllowedMethods:   []string{"GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token", "X-Request-Id"},
		ExposedHeaders:   []string{"X-Request-Id"},
		AllowCredentials: true,
		MaxAge:           300,
	})
}
