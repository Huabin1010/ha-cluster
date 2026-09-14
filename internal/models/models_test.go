package models

import (
	"strings"
	"testing"
)

func TestNormalizeProjectPurpose(t *testing.T) {
	ok, good := NormalizeProjectPurpose("  办公零食柜  ")
	if !good || ok != "办公零食柜" {
		t.Fatalf("got %q %v", ok, good)
	}
	if _, valid := NormalizeProjectPurpose(""); valid {
		t.Fatal("empty")
	}
	if _, valid := NormalizeProjectPurpose("a"); valid {
		t.Fatal("too short")
	}
	long := strings.Repeat("用", ProjectPurposeMaxRunes+1)
	if _, valid := NormalizeProjectPurpose(long); valid {
		t.Fatal("too long")
	}
	if HasProjectPurpose("") || HasProjectPurpose("x") {
		t.Fatal("empty is missing")
	}
	if !HasProjectPurpose("办公零食柜") {
		t.Fatal("filled")
	}
}

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

func TestRestoreStatusAfterDestroyReject(t *testing.T) {
	if RestoreStatusAfterDestroyReject(WSStopped) != WSStopped {
		t.Fatal("stopped should restore")
	}
	if RestoreStatusAfterDestroyReject("") != WSRunning {
		t.Fatal("empty should fall back to running")
	}
	if RestoreStatusAfterDestroyReject(WSDestroyPendingPlatform) != WSRunning {
		t.Fatal("destroy statuses should not restore as themselves")
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

func TestAuditResourceNameFromMetaIgnoresActorUsernameForWorkspace(t *testing.T) {
	meta := map[string]any{"username": "huanghuabin", "command": "uname -a"}
	if got := AuditResourceNameFromMeta("workspace", meta); got != "" {
		t.Fatalf("workspace name from actor username: %q", got)
	}
	meta["workspace_name"] = "office-box"
	if got := AuditResourceNameFromMeta("workspace", meta); got != "office-box" {
		t.Fatalf("workspace_name=%q", got)
	}
	// k8s object name must not replace the server name
	meta["name"] = "nginx-deploy"
	if got := AuditResourceNameFromMeta("workspace", meta); got != "office-box" {
		t.Fatalf("k8s name leaked: %q", got)
	}
	if got := AuditResourceNameFromMeta("user", map[string]any{"username": "huanghuabin"}); got != "huanghuabin" {
		t.Fatalf("user name=%q", got)
	}
	if got := AuditResourceNameFromMeta("tls_cert", map[string]any{"names": []string{"*.apps.example.com", "apps.example.com"}}); got != "*.apps.example.com · apps.example.com" {
		t.Fatalf("tls names=%q", got)
	}
	if got := AuditResourceNameFromMeta("tls_cert", map[string]any{"names": []any{"*.cl.qzsyzn.com"}}); got != "*.cl.qzsyzn.com" {
		t.Fatalf("tls any names=%q", got)
	}
	if got := AuditResourceNameFromMeta("ingress_domain_zone", map[string]any{"suffix": "apps.cl.qzsyzn.com"}); got != "apps.cl.qzsyzn.com" {
		t.Fatalf("zone suffix=%q", got)
	}
	if got := AuditResourceNameFromMeta("docker_registry", map[string]any{"server": "docker.cnb.cool"}); got != "docker.cnb.cool" {
		t.Fatalf("registry server=%q", got)
	}
}
