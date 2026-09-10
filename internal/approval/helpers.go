package approval

import "ha-cluster/internal/models"

// NeedsProjectApproval returns true when actor cannot self-approve this kind.
func NeedsProjectApproval(role string, kind Kind) bool {
	if models.CanApproveWorkspace(role) {
		return false
	}
	return LevelForKind(kind) == LevelSafe
}

// NeedsPlatformAfterProject returns true for dangerous ops after project pass.
func NeedsPlatformAfterProject(kind Kind) bool {
	return LevelForKind(kind) == LevelDangerous
}
