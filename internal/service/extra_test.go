package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

func TestRefreshAndLogout(t *testing.T) {
	app, u := setupApp(t)
	_, refresh, got, err := app.LoginTokens(context.Background(), u.Username, "password1")
	if err != nil || refresh == "" || got.ID != u.ID {
		t.Fatal(err, refresh)
	}
	access2, refresh2, u2, err := app.RefreshAccess(context.Background(), refresh)
	if err != nil || access2 == "" || refresh2 == "" || u2.ID != u.ID {
		t.Fatal(err)
	}
	if _, _, _, err := app.RefreshAccess(context.Background(), refresh); !errors.Is(err, store.ErrUnauthorized) {
		t.Fatal("old refresh must rotate away")
	}
	_ = app.LogoutRefresh(context.Background(), refresh2)
}

func TestInviteAccept(t *testing.T) {
	app, owner := setupApp(t)
	ctx := context.Background()
	p, _ := app.CreateProject(ctx, owner.ID, "inv", "inv")
	bob, _ := app.Register(ctx, "bobinv", "bobinv@x.com", "password1")
	inv, err := app.Invite(ctx, *owner, p.ID, bob.Email, models.RoleDeveloper)
	if err != nil {
		t.Fatal(err)
	}
	pid, err := app.AcceptInvite(ctx, *bob, inv.Token)
	if err != nil || pid != p.ID {
		t.Fatal(err, pid)
	}
	m, err := app.Store.GetMembership(ctx, p.ID, bob.ID)
	if err != nil || m.Role != models.RoleDeveloper {
		t.Fatal(err, m)
	}
}

func TestCreateProjectSlugValidation(t *testing.T) {
	app, u := setupApp(t)
	ctx := context.Background()
	cases := []string{"", "-lead", "trail-", "a--b", "has space", "under_score"}
	for _, slug := range cases {
		if _, err := app.CreateProject(ctx, u.ID, "n", slug); !errors.Is(err, store.ErrInvalidInput) {
			t.Fatalf("slug %q: want invalid input, got %v", slug, err)
		}
	}
	// Uppercase is normalized to lowercase before validate.
	if _, err := app.CreateProject(ctx, u.ID, "n", "Bad"); err != nil {
		t.Fatalf("uppercase should normalize: %v", err)
	}
	p, err := app.CreateProject(ctx, u.ID, "ok", "my-app")
	if err != nil || p.Slug != "my-app" {
		t.Fatal(err, p)
	}
	if _, err := app.CreateProject(ctx, u.ID, "dup", "my-app"); !errors.Is(err, store.ErrConflict) {
		t.Fatalf("duplicate slug: %v", err)
	}
}

func TestProjectBudget(t *testing.T) {
	app, u := setupApp(t)
	ctx := context.Background()
	p, _ := app.CreateProject(ctx, u.ID, "b", "b")
	p.BudgetMemBytes = 1 << 20
	if err := app.Store.UpdateProject(ctx, p); err != nil {
		t.Fatal(err)
	}
	_, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Plan: "nano", Arch: models.ArchAMD64, Actor: *u,
	})
	if !errors.Is(err, store.ErrNoCapacity) {
		t.Fatalf("budget should block nano, got %v", err)
	}
}

func TestReconcileReleasesOrphans(t *testing.T) {
	app, u := setupApp(t)
	ctx := context.Background()
	p, _ := app.CreateProject(ctx, u.ID, "r", "r")
	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{ProjectID: p.ID, Plan: "nano", Arch: models.ArchAMD64, Actor: *u})
	if err != nil {
		t.Fatal(err)
	}
	ws.Status = models.WSDestroyed
	_ = app.Store.UpdateWorkspace(ctx, ws)
	rel, _, err := app.Reconcile(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if rel < 1 {
		t.Fatalf("expected release, got %d", rel)
	}
}

func TestStaleHeartbeat(t *testing.T) {
	app, _ := setupApp(t)
	ctx := context.Background()
	nodes, _ := app.Store.ListNodes(ctx)
	n := nodes[0]
	n.LastHeartbeat = time.Now().Add(-10 * time.Minute)
	n.Ready = true
	_ = app.Store.UpsertNode(ctx, &n)
	_, stale, err := app.Reconcile(ctx)
	if err != nil || stale < 1 {
		t.Fatalf("stale=%d err=%v", stale, err)
	}
}

func TestSuspend(t *testing.T) {
	app, admin := setupApp(t)
	admin.PlatformRole = models.RolePlatformAdmin
	_ = app.Store.UpdateUser(context.Background(), admin)
	victim, _ := app.Register(context.Background(), "v", "v@x.com", "password1")
	if err := app.SuspendUser(context.Background(), *admin, victim.ID); err != nil {
		t.Fatal(err)
	}
	got, _ := app.Store.GetUserByID(context.Background(), victim.ID)
	if got.Status != models.UserSuspended || got.TokenVersion < 2 {
		t.Fatalf("%+v", got)
	}
	_ = uuid.Nil
}
