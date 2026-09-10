package authz

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store/memory"
)

func TestRequireProjectMemberNotFound(t *testing.T) {
	st := memory.New()
	u := models.User{ID: uuid.New(), PlatformRole: models.RolePlatformUser}
	_, err := RequireProjectMember(context.Background(), st, u, uuid.New(), models.RoleViewer)
	if err != ErrNotFound {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

func TestCanSSHSessionViewerNoGrant(t *testing.T) {
	m := &models.Membership{Role: models.RoleViewer, SSHAccess: models.SSHAccessNone}
	w := models.Workspace{Status: models.WSRunning, Visibility: models.VisShared}
	u := models.User{ID: uuid.New()}
	if CanSSHSession(u, m, w) {
		t.Fatal("viewer without grant should not ssh")
	}
}

func TestCanSSHSessionDeveloperGranted(t *testing.T) {
	m := &models.Membership{Role: models.RoleDeveloper, SSHAccess: models.SSHAccessGranted}
	w := models.Workspace{Status: models.WSRunning, Visibility: models.VisShared}
	u := models.User{ID: uuid.New()}
	if !CanSSHSession(u, m, w) {
		t.Fatal("granted developer should ssh")
	}
}

func TestCanSSHSessionAdminDefault(t *testing.T) {
	m := &models.Membership{Role: models.RoleAdmin}
	models.NormalizeMembershipSSH(m)
	w := models.Workspace{Status: models.WSRunning, Visibility: models.VisShared}
	u := models.User{ID: uuid.New()}
	if !CanSSHSession(u, m, w) {
		t.Fatal("admin should ssh")
	}
}
