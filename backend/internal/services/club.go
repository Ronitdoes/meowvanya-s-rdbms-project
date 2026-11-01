package services

import (
	"context"
	"errors"
	"log/slog"
	"strings"

	"github.com/campusconnect/backend/internal/apperr"
	"github.com/campusconnect/backend/internal/authctx"
	"github.com/campusconnect/backend/internal/models"
	"github.com/campusconnect/backend/internal/repositories"
	"github.com/jackc/pgx/v5"
)

// ClubService owns club discovery, membership and student-self rules.
type ClubService struct {
	clubs *repositories.ClubRepository
	authz *repositories.Authz
}

func NewClubService(clubs *repositories.ClubRepository, authz *repositories.Authz) *ClubService {
	return &ClubService{clubs: clubs, authz: authz}
}

func (s *ClubService) ListPublicClubs(ctx context.Context, search string, limit, offset int) ([]models.Club, int, error) {
	clubs, total, err := s.clubs.ListApprovedClubs(ctx, strings.TrimSpace(search), limit, offset)
	if err != nil {
		return nil, 0, clubStoreError("list public clubs", err)
	}
	return clubs, total, nil
}

func (s *ClubService) GetPublicClub(ctx context.Context, clubID int64) (models.Club, error) {
	club, err := s.clubs.FindApprovedClub(ctx, clubID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return models.Club{}, apperr.NotFound("Club not found.")
		}
		return models.Club{}, clubStoreError("find public club", err)
	}
	return club, nil
}

// JoinClub creates a pending membership request or reopens a rejected one.
func (s *ClubService) JoinClub(ctx context.Context, principal authctx.Principal, clubID int64) (models.MembershipRequest, error) {
	if principal.StudentID == nil {
		return models.MembershipRequest{}, apperr.Forbidden("A student profile is required to join a club.")
	}

	membership, err := s.clubs.RequestMembership(ctx, *principal.StudentID, clubID)
	switch {
	case err == nil:
		return membership, nil
	case errors.Is(err, pgx.ErrNoRows):
		return models.MembershipRequest{}, apperr.NotFound("Club not found.")
	case errors.Is(err, repositories.ErrClubNotApproved):
		// Pending/rejected clubs are not publicly discoverable.
		return models.MembershipRequest{}, apperr.NotFound("Club not found.")
	case errors.Is(err, repositories.ErrMembershipApproved):
		return models.MembershipRequest{}, apperr.Conflict("You are already a member of this club.")
	case errors.Is(err, repositories.ErrMembershipPending):
		return models.MembershipRequest{}, apperr.Conflict("Your membership request is awaiting review.")
	default:
		return models.MembershipRequest{}, clubStoreError("request membership", err)
	}
}

// ListMembers returns a club's membership page for its coordinator or an admin.
func (s *ClubService) ListMembers(ctx context.Context, principal authctx.Principal, clubID int64, status, search string, limit, offset int) ([]models.ClubMember, int, error) {
	status = strings.TrimSpace(status)
	if status != "" && !validClubMembershipStatus(status) {
		return nil, 0, apperr.Validation(map[string]string{
			"status": "Status must be pending, approved or rejected.",
		})
	}
	if err := s.requireClubManager(ctx, principal, clubID); err != nil {
		return nil, 0, err
	}

	members, total, err := s.clubs.ListClubMembers(ctx, clubID, status, strings.TrimSpace(search), limit, offset)
	if err != nil {
		return nil, 0, clubStoreError("list club members", err)
	}
	return members, total, nil
}

// DecideMember approves or rejects a pending membership request.
func (s *ClubService) DecideMember(ctx context.Context, principal authctx.Principal, clubID, membershipID int64, status string) (models.ClubMember, error) {
	status = strings.TrimSpace(status)
	if status != "approved" && status != "rejected" {
		return models.ClubMember{}, apperr.Validation(map[string]string{
			"status": "Status must be approved or rejected.",
		})
	}
	if err := s.requireClubManager(ctx, principal, clubID); err != nil {
		return models.ClubMember{}, err
	}

	member, err := s.clubs.DecideClubMembership(ctx, clubID, membershipID, status, principal.UserID)
	switch {
	case err == nil:
		return member, nil
	case errors.Is(err, pgx.ErrNoRows):
		return models.ClubMember{}, apperr.NotFound("Membership request not found.")
	case errors.Is(err, repositories.ErrMembershipNotPending):
		return models.ClubMember{}, apperr.Conflict("This membership request has already been decided.")
	default:
		return models.ClubMember{}, clubStoreError("decide membership", err)
	}
}

// UpdateMemberRole promotes or demotes an approved club member.
func (s *ClubService) UpdateMemberRole(ctx context.Context, principal authctx.Principal, clubID, membershipID int64, role string) (models.ClubMember, error) {
	role = strings.TrimSpace(role)
	if role != "member" && role != "coordinator" {
		return models.ClubMember{}, apperr.Validation(map[string]string{
			"role": "Role must be member or coordinator.",
		})
	}
	if err := s.requireClubManager(ctx, principal, clubID); err != nil {
		return models.ClubMember{}, err
	}

	member, err := s.clubs.UpdateMembershipRole(ctx, clubID, membershipID, role)
	switch {
	case err == nil:
		return member, nil
	case errors.Is(err, pgx.ErrNoRows):
		return models.ClubMember{}, apperr.NotFound("Club member not found.")
	case errors.Is(err, repositories.ErrMembershipNotApproved):
		return models.ClubMember{}, apperr.Conflict("Only approved members can change roles.")
	case errors.Is(err, repositories.ErrLastCoordinator):
		return models.ClubMember{}, apperr.Conflict("A club must keep at least one approved coordinator.")
	default:
		return models.ClubMember{}, clubStoreError("update member role", err)
	}
}

// RemoveMember deletes a membership while preserving the last coordinator.
func (s *ClubService) RemoveMember(ctx context.Context, principal authctx.Principal, clubID, membershipID int64) error {
	if err := s.requireClubManager(ctx, principal, clubID); err != nil {
		return err
	}

	err := s.clubs.DeleteMembership(ctx, clubID, membershipID)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, pgx.ErrNoRows):
		return apperr.NotFound("Club member not found.")
	case errors.Is(err, repositories.ErrLastCoordinator):
		return apperr.Conflict("A club must keep at least one approved coordinator.")
	default:
		return clubStoreError("remove club member", err)
	}
}

// MyMemberships lists the caller's own club membership requests.
func (s *ClubService) MyMemberships(ctx context.Context, principal authctx.Principal) ([]models.MembershipRequest, error) {
	studentID, err := requireClubStudent(principal)
	if err != nil {
		return nil, err
	}

	memberships, err := s.clubs.ListMembershipsForStudent(ctx, studentID)
	if err != nil {
		return nil, clubStoreError("list student memberships", err)
	}
	return memberships, nil
}

// Dashboard assembles the student's self-service dashboard.
func (s *ClubService) Dashboard(ctx context.Context, principal authctx.Principal) (models.StudentDashboard, error) {
	studentID, err := requireClubStudent(principal)
	if err != nil {
		return models.StudentDashboard{}, err
	}

	counts, err := s.clubs.StudentDashboardCounts(ctx, studentID)
	if err != nil {
		return models.StudentDashboard{}, clubStoreError("load dashboard counts", err)
	}
	upcoming, err := s.clubs.UpcomingEvents(ctx, 4)
	if err != nil {
		return models.StudentDashboard{}, clubStoreError("load dashboard upcoming events", err)
	}
	recent, err := s.clubs.RecentRegistrations(ctx, studentID, 5)
	if err != nil {
		return models.StudentDashboard{}, clubStoreError("load dashboard recent registrations", err)
	}

	return models.StudentDashboard{
		ClubsJoined:           counts.ClubsJoined,
		ApprovedMemberships:   counts.ApprovedMemberships,
		PendingMemberships:    counts.PendingMemberships,
		EventsRegistered:      counts.EventsRegistered,
		UpcomingRegistrations: counts.UpcomingRegistrations,
		CertificatesEarned:    counts.CertificatesEarned,
		UpcomingEvents:        upcoming,
		RecentRegistrations:   recent,
	}, nil
}

// CoordinatedClubs lists clubs the caller coordinates. Admins do not have a
// student profile, so the endpoint intentionally returns an empty list for them.
func (s *ClubService) CoordinatedClubs(ctx context.Context, principal authctx.Principal) ([]models.Club, error) {
	if principal.IsAdmin() {
		return []models.Club{}, nil
	}
	if principal.StudentID == nil {
		return nil, apperr.Forbidden("A student profile is required for this action.")
	}

	clubs, err := s.clubs.CoordinatedClubs(ctx, principal.UserID)
	if err != nil {
		return nil, clubStoreError("list coordinated clubs", err)
	}
	return clubs, nil
}

// requireClubManager enforces "admin or approved coordinator of this club".
func (s *ClubService) requireClubManager(ctx context.Context, principal authctx.Principal, clubID int64) error {
	if principal.IsAdmin() {
		exists, err := s.clubs.ClubExists(ctx, clubID)
		if err != nil {
			return clubStoreError("check club", err)
		}
		if !exists {
			return apperr.NotFound("Club not found.")
		}
		return nil
	}

	ok, err := s.authz.IsClubCoordinator(ctx, principal.UserID, clubID)
	if err != nil {
		return clubStoreError("check club coordinator", err)
	}
	if ok {
		return nil
	}
	// Distinguish an unknown club (404) from a known club the caller cannot manage.
	exists, err := s.clubs.ClubExists(ctx, clubID)
	if err != nil {
		return clubStoreError("check club", err)
	}
	if !exists {
		return apperr.NotFound("Club not found.")
	}
	return apperr.Forbidden("Only this club's coordinator can manage its members.")
}

func requireClubStudent(principal authctx.Principal) (int64, error) {
	if principal.StudentID == nil {
		return 0, apperr.Forbidden("A student profile is required for this action.")
	}
	return *principal.StudentID, nil
}

func validClubMembershipStatus(status string) bool {
	return status == "pending" || status == "approved" || status == "rejected"
}

func clubStoreError(action string, err error) error {
	if appErr, ok := apperr.As(err); ok {
		return appErr
	}
	slog.Error("club service: "+action, "error", err)
	return apperr.Internal(err)
}
