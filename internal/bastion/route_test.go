package bastion

import (
	"testing"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
)

func mem(role, ssh string) *models.Membership {
	m := &models.Membership{Role: role, SSHAccess: ssh}
	models.NormalizeMembershipSSH(m)
	return m
}

func TestResolvePrefersFabric(t *testing.T) {
	ownerID := uuid.New()
	actor := models.User{ID: ownerID}
	w := models.Workspace{Status: models.WSRunning, SSHPort: 22001, Visibility: models.VisShared, OwnerUserID: ownerID}
	n := models.Node{FabricIP: "10.129.129.10", LanIP: "192.168.1.10", BreakglassSSH: "vps:8092"}
	tg, err := Resolve(w, n, actor, mem(models.RoleDeveloper, models.SSHAccessGranted))
	if err != nil || tg.Via != "fabric" || tg.Host != "10.129.129.10" {
		t.Fatalf("%+v %v", tg, err)
	}
}

func TestResolveViewerDenied(t *testing.T) {
	w := models.Workspace{Status: models.WSRunning, SSHPort: 22}
	n := models.Node{FabricIP: "10.129.129.10"}
	actor := models.User{ID: uuid.New()}
	if _, err := Resolve(w, n, actor, mem(models.RoleViewer, models.SSHAccessNone)); err != ErrDenied {
		t.Fatalf("%v", err)
	}
}

func TestResolveStopped(t *testing.T) {
	w := models.Workspace{Status: models.WSStopped, SSHPort: 22}
	n := models.Node{FabricIP: "10.129.129.10"}
	actor := models.User{ID: uuid.New()}
	if _, err := Resolve(w, n, actor, mem(models.RoleDeveloper, models.SSHAccessGranted)); err != ErrOffline {
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
	n := models.Node{FabricIP: "10.129.129.10"}

	if _, err := Resolve(w, n, models.User{ID: otherUser}, mem(models.RoleDeveloper, models.SSHAccessGranted)); err != ErrDenied {
		t.Fatalf("expected ErrDenied, got %v", err)
	}

	tg, err := Resolve(w, n, models.User{ID: ownerID}, mem(models.RoleDeveloper, models.SSHAccessGranted))
	if err != nil || tg.Host != "10.129.129.10" {
		t.Fatalf("owner access failed: %v", err)
	}

	tg, err = Resolve(w, n, models.User{ID: otherUser}, mem(models.RoleAdmin, ""))
	if err != nil || tg.Host != "10.129.129.10" {
		t.Fatalf("admin access failed: %v", err)
	}

	tg, err = Resolve(w, n, models.User{ID: otherUser, PlatformRole: models.RolePlatformAdmin}, nil)
	if err != nil || tg.Host != "10.129.129.10" {
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
