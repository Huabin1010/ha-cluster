package authz

import (
	"context"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

// RequireProjectMember returns membership if user meets minRole. Non-members get ErrNotFound.
// platform_admin gets synthetic owner membership without DB row.
func RequireProjectMember(ctx context.Context, st store.Store, user models.User, projectID uuid.UUID, minRole string) (*models.Membership, error) {
	if IsPlatformAdmin(user) {
		return &models.Membership{
			ProjectID: projectID,
			UserID:    user.ID,
			Role:      models.RoleOwner,
			SSHAccess: models.SSHAccessGranted,
			SSHMode:   models.SSHModeReadWrite,
		}, nil
	}
	m, err := st.GetMembership(ctx, projectID, user.ID)
	if err != nil {
		if err == store.ErrNotFound {
			return nil, ErrNotFound
		}
		return nil, err
	}
	models.NormalizeMembershipSSH(m)
	if models.RoleRank(m.Role) < models.RoleRank(minRole) {
		return nil, ErrForbidden
	}
	return m, nil
}

func CanManageMembers(role string) bool {
	return models.RoleRank(role) >= models.RoleRank(models.RoleAdmin)
}

func CanApproveProject(role string) bool {
	return models.CanApproveWorkspace(role)
}

func IsProjectOwner(role string) bool {
	return role == models.RoleOwner
}
