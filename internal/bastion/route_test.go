package bastion

import (
	"testing"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
)

func TestResolvePrefersFabric(t *testing.T) {
	ownerID := uuid.New()
	w := models.Workspace{Status: models.WSRunning, SSHPort: 22001, Visibility: models.VisShared, OwnerUserID: ownerID}
	n := models.Node{FabricIP: "10.88.0.10", LanIP: "192.168.1.10", BreakglassSSH: "vps:8092"}
	tg, err := Resolve(w, n, models.RoleDeveloper, ownerID, false)
	if err != nil || tg.Via != "fabric" || tg.Host != "10.88.0.10" {
		t.Fatalf("%+v %v", tg, err)
	}
}

func TestResolveViewerDenied(t *testing.T) {
	w := models.Workspace{Status: models.WSRunning, SSHPort: 22}
	n := models.Node{FabricIP: "10.88.0.10"}
	if _, err := Resolve(w, n, models.RoleViewer, uuid.New(), false); err != ErrDenied {
		t.Fatalf("%v", err)
	}
}

func TestResolveStopped(t *testing.T) {
	w := models.Workspace{Status: models.WSStopped, SSHPort: 22}
	n := models.Node{FabricIP: "10.88.0.10"}
	if _, err := Resolve(w, n, models.RoleDeveloper, uuid.New(), false); err != ErrOffline {
		t.Fatalf("%v", err)
	}
}

func TestResolvePrivateWorkspace(t *testing.T) {
	ownerID := uuid.New()
	otherUser := uuid.New()
	w := models.Workspace{
		Status:      models.WSRunning,
		SSHPort:     22,
		Visibility:  models.VisPrivate,
		OwnerUserID: ownerID,
	}
	n := models.Node{FabricIP: "10.88.0.10"}

	// 1. Other developer cannot access private workspace
	if _, err := Resolve(w, n, models.RoleDeveloper, otherUser, false); err != ErrDenied {
		t.Fatalf("expected ErrDenied, got %v", err)
	}

	// 2. Owner developer can access
	tg, err := Resolve(w, n, models.RoleDeveloper, ownerID, false)
	if err != nil || tg.Host != "10.88.0.10" {
		t.Fatalf("owner access failed: %v", err)
	}

	// 3. Admin can access private workspace
	tg, err = Resolve(w, n, models.RoleAdmin, otherUser, false)
	if err != nil || tg.Host != "10.88.0.10" {
		t.Fatalf("admin access failed: %v", err)
	}

	// 4. Platform admin can access
	tg, err = Resolve(w, n, models.RoleViewer, otherUser, true)
	if err != nil || tg.Host != "10.88.0.10" {
		t.Fatalf("platform admin access failed: %v", err)
	}
}

func TestPrivateACL(t *testing.T) {
	oid := uuid.New().String()
	aid := uuid.New().String()
	w := models.Workspace{Visibility: models.VisPrivate}
	if CanEnterPrivate(w, aid, oid, models.RoleDeveloper, false) {
		t.Fatal("dev must not enter others private ws")
	}
	if !CanEnterPrivate(w, oid, oid, models.RoleDeveloper, false) {
		t.Fatal("owner can")
	}
	if !CanEnterPrivate(w, aid, oid, models.RoleAdmin, false) {
		t.Fatal("admin can")
	}
}

func TestParseHostPort(t *testing.T) {
	h, p := parseHostPort("127.0.0.1:8092", 22)
	if h != "127.0.0.1" || p != 8092 {
		t.Fatalf("%s %d", h, p)
	}
}
