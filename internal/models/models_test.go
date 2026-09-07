package models

import "testing"

func TestRoleRankOrdering(t *testing.T) {
	if RoleRank(RoleOwner) <= RoleRank(RoleAdmin) {
		t.Fatal()
	}
	if !CanSSH(RoleDeveloper) || CanSSH(RoleViewer) {
		t.Fatal()
	}
	if CanManageMembers(RoleDeveloper) || !CanManageMembers(RoleAdmin) {
		t.Fatal()
	}
}

func TestPlansHaveLarge(t *testing.T) {
	p, ok := Plans()["large"]
	if !ok || p.CPUMilli != 4000 || p.MemBytes != 2*1024*1024*1024 {
		t.Fatalf("%+v", p)
	}
}
