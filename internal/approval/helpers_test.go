package approval

import (
	"testing"

	"ha-cluster/internal/models"
)

func TestNeedsProjectApproval(t *testing.T) {
	if !NeedsProjectApproval(models.RoleDeveloper, KindWorkspaceCreate) {
		t.Fatal("developer needs approval for create")
	}
	if NeedsProjectApproval(models.RoleAdmin, KindWorkspaceCreate) {
		t.Fatal("admin self-approves create")
	}
	if NeedsProjectApproval(models.RoleDeveloper, KindWorkspaceDestroy) {
		t.Fatal("destroy uses workspace status machine, not role gate")
	}
}

func TestNeedsPlatformAfterProject(t *testing.T) {
	if !NeedsPlatformAfterProject(KindWorkspaceDestroy) {
		t.Fatal("destroy needs platform")
	}
	if NeedsPlatformAfterProject(KindWorkspaceResize) {
		t.Fatal("resize is safe")
	}
}
