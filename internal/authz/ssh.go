package authz

import (
	"github.com/google/uuid"

	"ha-cluster/internal/models"
)

// CanSSHSession checks project SSH grant + workspace ACL + running state.
func CanSSHSession(actor models.User, m *models.Membership, w models.Workspace) bool {
	if IsPlatformAdmin(actor) {
		return w.Status == models.WSRunning || w.Status == models.WSDegraded || w.Status == models.WSSuspended
	}
	if m == nil {
		return false
	}
	if !hasSSHAccess(m) {
		return false
	}
	if w.Visibility == models.VisPrivate {
		if w.OwnerUserID != actor.ID && models.RoleRank(m.Role) < models.RoleRank(models.RoleAdmin) {
			return false
		}
	}
	switch w.Status {
	case models.WSRunning, models.WSDegraded, models.WSSuspended:
		return true
	default:
		return false
	}
}

func hasSSHAccess(m *models.Membership) bool {
	if m == nil {
		return false
	}
	if models.RoleRank(m.Role) >= models.RoleRank(models.RoleAdmin) {
		return true
	}
	return m.SSHAccess == models.SSHAccessGranted
}

// CanEnterPrivateWorkspace for bastion routing.
func CanEnterPrivateWorkspace(w models.Workspace, actorUserID uuid.UUID, role string, isPlatformAdmin bool) bool {
	if isPlatformAdmin {
		return true
	}
	if w.Visibility != models.VisPrivate {
		return true
	}
	if actorUserID == w.OwnerUserID {
		return true
	}
	return models.RoleRank(role) >= models.RoleRank(models.RoleAdmin)
}

// CollectWorkspaceSSHUserIDs returns user IDs whose keys should be on a shared workspace.
func CollectWorkspaceSSHUserIDs(members []models.Membership, ownerID uuid.UUID, visibility string) []uuid.UUID {
	if visibility == models.VisPrivate {
		return []uuid.UUID{ownerID}
	}
	var ids []uuid.UUID
	for _, m := range members {
		models.NormalizeMembershipSSH(&m)
		if hasSSHAccess(&m) && models.CanSSHRole(m.Role) {
			ids = append(ids, m.UserID)
		}
	}
	return ids
}
