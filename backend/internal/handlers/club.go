package handlers

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/campusconnect/backend/internal/apperr"
	"github.com/campusconnect/backend/internal/authctx"
	"github.com/campusconnect/backend/internal/httpx"
	"github.com/campusconnect/backend/internal/services"
)

// ClubHandler exposes public club discovery, coordinator membership management
// and the student self-service endpoints owned by the clubs slice.
type ClubHandler struct {
	svc *services.ClubService
}

func NewClubHandler(svc *services.ClubService) *ClubHandler {
	return &ClubHandler{svc: svc}
}

type clubMembershipDecisionRequest struct {
	Status string `json:"status"`
}

type clubMemberRoleRequest struct {
	Role string `json:"role"`
}

func (h *ClubHandler) ListClubs(w http.ResponseWriter, r *http.Request) {
	page, pageSize, offset := httpx.Pagination(r)
	search := httpx.QueryString(r, "search")

	clubs, total, err := h.svc.ListPublicClubs(r.Context(), search, pageSize, offset)
	if err != nil {
		h.fail(w, "list clubs", err)
		return
	}
	httpx.Paginated(w, clubs, page, pageSize, total)
}

func (h *ClubHandler) GetClub(w http.ResponseWriter, r *http.Request) {
	clubID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}

	club, err := h.svc.GetPublicClub(r.Context(), clubID)
	if err != nil {
		h.fail(w, "get club", err)
		return
	}
	httpx.JSON(w, http.StatusOK, club)
}

func (h *ClubHandler) JoinClub(w http.ResponseWriter, r *http.Request) {
	clubID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}

	membership, err := h.svc.JoinClub(r.Context(), authctx.MustFromRequest(r), clubID)
	if err != nil {
		h.fail(w, "join club", err)
		return
	}
	httpx.Created(w, membership)
}

func (h *ClubHandler) ListMembers(w http.ResponseWriter, r *http.Request) {
	clubID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	page, pageSize, offset := httpx.Pagination(r)
	status := httpx.QueryString(r, "status")
	search := httpx.QueryString(r, "search")

	members, total, err := h.svc.ListMembers(
		r.Context(),
		authctx.MustFromRequest(r),
		clubID,
		status,
		search,
		pageSize,
		offset,
	)
	if err != nil {
		h.fail(w, "list club members", err)
		return
	}
	httpx.Paginated(w, members, page, pageSize, total)
}

func (h *ClubHandler) DecideMember(w http.ResponseWriter, r *http.Request) {
	clubID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	membershipID, err := httpx.PathInt64(r, "membershipId")
	if err != nil {
		httpx.FailError(w, err)
		return
	}

	var req clubMembershipDecisionRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.FailError(w, err)
		return
	}
	req.Status = strings.TrimSpace(req.Status)
	if req.Status == "" {
		httpx.FailError(w, apperr.Validation(map[string]string{
			"status": "This field is required.",
		}))
		return
	}

	member, err := h.svc.DecideMember(r.Context(), authctx.MustFromRequest(r), clubID, membershipID, req.Status)
	if err != nil {
		h.fail(w, "decide membership", err)
		return
	}
	httpx.JSON(w, http.StatusOK, member)
}

func (h *ClubHandler) UpdateMemberRole(w http.ResponseWriter, r *http.Request) {
	clubID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	membershipID, err := httpx.PathInt64(r, "membershipId")
	if err != nil {
		httpx.FailError(w, err)
		return
	}

	var req clubMemberRoleRequest
	if err := httpx.Decode(w, r, &req); err != nil {
		httpx.FailError(w, err)
		return
	}
	req.Role = strings.TrimSpace(req.Role)
	if req.Role == "" {
		httpx.FailError(w, apperr.Validation(map[string]string{
			"role": "This field is required.",
		}))
		return
	}

	member, err := h.svc.UpdateMemberRole(r.Context(), authctx.MustFromRequest(r), clubID, membershipID, req.Role)
	if err != nil {
		h.fail(w, "update member role", err)
		return
	}
	httpx.JSON(w, http.StatusOK, member)
}

func (h *ClubHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	clubID, err := httpx.PathInt64(r, "id")
	if err != nil {
		httpx.FailError(w, err)
		return
	}
	membershipID, err := httpx.PathInt64(r, "membershipId")
	if err != nil {
		httpx.FailError(w, err)
		return
	}

	if err := h.svc.RemoveMember(r.Context(), authctx.MustFromRequest(r), clubID, membershipID); err != nil {
		h.fail(w, "remove club member", err)
		return
	}
	httpx.NoContent(w)
}

func (h *ClubHandler) MyMemberships(w http.ResponseWriter, r *http.Request) {
	memberships, err := h.svc.MyMemberships(r.Context(), authctx.MustFromRequest(r))
	if err != nil {
		h.fail(w, "list my memberships", err)
		return
	}
	httpx.JSON(w, http.StatusOK, memberships)
}

func (h *ClubHandler) MyDashboard(w http.ResponseWriter, r *http.Request) {
	dashboard, err := h.svc.Dashboard(r.Context(), authctx.MustFromRequest(r))
	if err != nil {
		h.fail(w, "load student dashboard", err)
		return
	}
	httpx.JSON(w, http.StatusOK, dashboard)
}

func (h *ClubHandler) MyCoordinatedClubs(w http.ResponseWriter, r *http.Request) {
	clubs, err := h.svc.CoordinatedClubs(r.Context(), authctx.MustFromRequest(r))
	if err != nil {
		h.fail(w, "list coordinated clubs", err)
		return
	}
	httpx.JSON(w, http.StatusOK, clubs)
}

// fail logs only unexpected failures; application errors are already safe.
func (h *ClubHandler) fail(w http.ResponseWriter, action string, err error) {
	if _, ok := apperr.As(err); !ok {
		slog.Error("club handler: "+action, "error", err)
		err = apperr.Internal(err)
	}
	httpx.FailError(w, err)
}
