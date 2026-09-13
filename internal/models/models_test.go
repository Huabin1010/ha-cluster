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
	if CanApproveWorkspace(RoleDeveloper) || !CanApproveWorkspace(RoleAdmin) || !CanApproveWorkspace(RoleOwner) {
		t.Fatal()
	}
}

func TestPlansHaveLarge(t *testing.T) {
	p, ok := Plans()["large"]
	if !ok || p.CPUMilli != 4000 || p.MemBytes != 2*1024*1024*1024 {
		t.Fatalf("%+v", p)
	}
	small, ok := Plans()["small"]
	if !ok || small.CPUMilli != 1000 || small.MemBytes != 512*1024*1024 || small.DiskBytes != 5*1024*1024*1024 {
		t.Fatalf("small %+v", small)
	}
	p2, ok := Plans()["2c2g"]
	if !ok || p2.CPUMilli != 2000 || p2.MemBytes != 2*1024*1024*1024 || p2.DiskBytes != 5*1024*1024*1024 {
		t.Fatalf("2c2g %+v", p2)
	}
}

func TestProvisioningLiveAndWorkspaceClosed(t *testing.T) {
	if !ProvisioningLive(WSProvisioning) {
		t.Fatal("provisioning should be live")
	}
	if ProvisioningLive(WSDestroyed) || ProvisioningLive(WSFailed) || ProvisioningLive(WSRunning) {
		t.Fatal("terminal statuses must not be live")
	}
	if !WorkspaceClosed(WSDestroyed) || !WorkspaceClosed(WSDestroying) || !WorkspaceClosed(WSRejected) {
		t.Fatal("closed statuses")
	}
	if WorkspaceClosed(WSRunning) || WorkspaceClosed(WSProvisioning) {
		t.Fatal("live statuses must not be closed")
	}
}

func TestNormalizeRuntimeAndNodeSupportsK8s(t *testing.T) {
	if NormalizeRuntime("") != RuntimeContainer || NormalizeRuntime("incus") != RuntimeContainer {
		t.Fatal("container aliases")
	}
	if NormalizeRuntime("kubernetes") != RuntimeK8s || !IsK8sRuntime("k3s") {
		t.Fatal("k8s aliases")
	}
	if NormalizeRuntime("qemu") != "" {
		t.Fatal("unknown runtime")
	}
	if RuntimeLabel("k8s") != "Kubernetes" || RuntimeLabel("") != "Docker + SSH" {
		t.Fatal("labels")
	}
	if !NodeSupportsK8s([]string{"runtime=k3s"}) || NodeSupportsK8s([]string{"gpu"}) {
		t.Fatal("node tags")
	}
}

func TestResolveSpecCustomAndCatalog(t *testing.T) {
	p, err := ResolveSpec("nano", 0, 0, 0)
	if err != nil || p.Name != "nano" {
		t.Fatal(err, p)
	}
	custom, err := ResolveSpec("", 2000, 2*1024*1024*1024, 5*1024*1024*1024)
	if err != nil || custom.Name != "custom" || custom.CPUMilli != 2000 {
		t.Fatal(err, custom)
	}
	if _, err := ResolveSpec("nope", 0, 0, 0); err == nil {
		t.Fatal("want unknown plan")
	}
	if _, err := ResolveSpec("custom", 1, 1, 1); err == nil {
		t.Fatal("want invalid spec")
	}
}
