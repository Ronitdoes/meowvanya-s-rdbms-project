package authctx

import (
	"context"
	"net/http"
)

type Principal struct {
	UserID    int64  `json:"userId"`
	Email     string `json:"email"`
	Role      string `json:"role"`
	StudentID *int64 `json:"studentId,omitempty"`
}

func (p Principal) IsStudent() bool     { return p.Role == "student" }
func (p Principal) IsCoordinator() bool { return p.Role == "coordinator" }
func (p Principal) IsAdmin() bool       { return p.Role == "admin" }
func (p Principal) HasRole(roles ...string) bool {
	for _, r := range roles {
		if p.Role == r {
			return true
		}
	}
	return false
}

type contextKey struct{}

var principalKey contextKey

func WithPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, principalKey, p)
}

func FromContext(ctx context.Context) (Principal, bool) {
	p, ok := ctx.Value(principalKey).(Principal)
	return p, ok
}

func MustFromRequest(r *http.Request) Principal {
	p, _ := FromContext(r.Context())
	return p
}
