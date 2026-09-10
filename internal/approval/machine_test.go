package approval

import "testing"

func TestDangerousDestroyFlow(t *testing.T) {
	k := KindWorkspaceDestroy
	if LevelForKind(k) != LevelDangerous {
		t.Fatal("destroy should be dangerous")
	}
	next, err := NextAfterProjectApprove(k)
	if err != nil || next != PhasePendingPlatform {
		t.Fatalf("want pending_platform, got %v err=%v", next, err)
	}
	if !CanPlatformApprove(PhasePendingPlatform, k) {
		t.Fatal("platform should approve")
	}
}

func TestSafeCreateFlow(t *testing.T) {
	k := KindWorkspaceCreate
	next, err := NextAfterProjectApprove(k)
	if err != nil || next != PhaseApprovedProject {
		t.Fatalf("want approved_project, got %v", next)
	}
}
