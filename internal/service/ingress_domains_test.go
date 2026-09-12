package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

func seedIngressWS(t *testing.T, app *App, owner *models.User) (*models.Workspace, *models.User, *models.User) {
	t.Helper()
	ctx := context.Background()
	node := &models.Node{
		ID:              uuid.New(),
		Name:            "n-ing-" + uuid.NewString()[:8],
		FabricIP:        "10.88.0.2",
		AllocatableCPU:  8000,
		AllocatableMem:  16 * 1024 * 1024 * 1024,
		AllocatableDisk: 100 * 1024 * 1024 * 1024,
		Arch:            "x86_64",
		Ready:           true,
	}
	if err := app.Store.UpsertNode(ctx, node); err != nil {
		t.Fatal(err)
	}
	p, err := app.CreateProject(ctx, owner.ID, "proj-zone", "pz"+uuid.NewString()[:6])
	if err != nil {
		t.Fatal(err)
	}
	devUser, err := app.Register(ctx, "zdev"+uuid.NewString()[:6], uuid.NewString()[:8]+"@x.com", "password1")
	if err != nil {
		t.Fatal(err)
	}
	if err := app.Store.AddMembership(ctx, models.Membership{
		ProjectID: p.ID, UserID: devUser.ID, Role: models.RoleDeveloper,
	}); err != nil {
		t.Fatal(err)
	}
	adminUser, err := app.Register(ctx, "zadm"+uuid.NewString()[:6], uuid.NewString()[:8]+"@x.com", "password1")
	if err != nil {
		t.Fatal(err)
	}
	if err := app.Store.AddMembership(ctx, models.Membership{
		ProjectID: p.ID, UserID: adminUser.ID, Role: models.RoleAdmin,
	}); err != nil {
		t.Fatal(err)
	}
	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "ws-zone", Plan: "nano", Arch: "x86_64",
		Visibility: models.VisPrivate, Actor: *devUser,
	})
	if err != nil {
		t.Fatal(err)
	}
	ws.Status = models.WSRunning
	if err := app.Store.UpdateWorkspace(ctx, ws); err != nil {
		t.Fatal(err)
	}
	return ws, devUser, adminUser
}

func TestIngressDomainZonesAndSharedClaim(t *testing.T) {
	app, owner := setupApp(t)
	ctx := context.Background()
	ws, devUser, _ := seedIngressWS(t, app, owner)

	// non-admin cannot create zone
	_, err := app.CreateIngressDomainZone(ctx, CreateIngressDomainZoneInput{
		Suffix: "apps.example.com", DisplayName: "Apps", Actor: *devUser,
	})
	if !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("expected forbidden, got %v", err)
	}

	free, err := app.CreateIngressDomainZone(ctx, CreateIngressDomainZoneInput{
		Suffix: "apps.example.com", DisplayName: "Apps",
		RequireApproval: false, Enabled: true,
		AllowRandom: true, AllowCustomPrefix: true, Actor: *owner,
	})
	if err != nil {
		t.Fatal(err)
	}
	need, err := app.CreateIngressDomainZone(ctx, CreateIngressDomainZoneInput{
		Suffix: "need.example.com", DisplayName: "Need",
		RequireApproval: true, Enabled: true, Actor: *owner,
	})
	if err != nil {
		t.Fatal(err)
	}

	meta := app.IngressPublicInfo(ctx)
	zones, _ := meta["zones"].([]map[string]any)
	if len(zones) < 2 {
		t.Fatalf("expected enabled zones in meta, got %#v", meta["zones"])
	}

	// shared custom claim → active
	r1, err := app.ClaimSharedIngress(ctx, ClaimSharedIngressInput{
		WorkspaceID: ws.ID, ZoneID: free.ID, Mode: "custom", Prefix: "hello",
		Port: 8080, Actor: *devUser,
	})
	if err != nil {
		t.Fatal(err)
	}
	if r1.Status != models.IngressActive || r1.Domain != "hello.apps.example.com" {
		t.Fatalf("unexpected shared claim: %+v", r1)
	}
	if r1.DomainTier != models.IngressTierShared || r1.Prefix != "hello" {
		t.Fatalf("expected shared tier/prefix, got %+v", r1)
	}

	// reserved prefix
	_, err = app.ClaimSharedIngress(ctx, ClaimSharedIngressInput{
		WorkspaceID: ws.ID, ZoneID: free.ID, Mode: "custom", Prefix: "admin",
		Port: 8080, Actor: *devUser, ConfirmSecondPort: true,
	})
	if !errors.Is(err, store.ErrInvalidInput) {
		t.Fatalf("expected invalid for reserved prefix, got %v", err)
	}

	// conflict
	_, err = app.ClaimSharedIngress(ctx, ClaimSharedIngressInput{
		WorkspaceID: ws.ID, ZoneID: free.ID, Mode: "custom", Prefix: "hello",
		Port: 8081, Actor: *devUser, ConfirmSecondPort: true,
	})
	if !errors.Is(err, store.ErrConflict) {
		t.Fatalf("expected conflict, got %v", err)
	}

	// random claim
	rRand, err := app.ClaimSharedIngress(ctx, ClaimSharedIngressInput{
		WorkspaceID: ws.ID, ZoneID: free.ID, Mode: "random",
		Port: 8082, Actor: *devUser, ConfirmSecondPort: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if rRand.Status != models.IngressActive || !strings.HasSuffix(rRand.Domain, ".apps.example.com") {
		t.Fatalf("unexpected random claim: %+v", rRand)
	}

	// need-approval zone via CreateIngress → pending for developer
	rNeed, err := app.CreateIngress(ctx, CreateIngressInput{
		WorkspaceID: ws.ID, ZoneID: &need.ID, Prefix: "team1",
		Port: 9000, Actor: *devUser, ConfirmSecondPort: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if rNeed.Status != models.IngressPendingApproval || rNeed.Domain != "team1.need.example.com" {
		t.Fatalf("expected pending need-approval route, got %+v", rNeed)
	}

	// cannot masquerade free suffix as custom domain
	_, err = app.CreateIngress(ctx, CreateIngressInput{
		WorkspaceID: ws.ID, Domain: "sneaky.apps.example.com",
		Port: 9001, Actor: *devUser, ConfirmSecondPort: true,
	})
	if !errors.Is(err, store.ErrInvalidInput) {
		t.Fatalf("expected invalid for free-suffix masquerade, got %v", err)
	}

	// disabled zone rejected
	free.Enabled = false
	free.UpdatedAt = time.Now()
	if err := app.Store.UpdateIngressDomainZone(ctx, free); err != nil {
		t.Fatal(err)
	}
	_, err = app.ClaimSharedIngress(ctx, ClaimSharedIngressInput{
		WorkspaceID: ws.ID, ZoneID: free.ID, Mode: "custom", Prefix: "newone",
		Port: 9002, Actor: *devUser, ConfirmSecondPort: true,
	})
	if !errors.Is(err, store.ErrInvalidInput) {
		t.Fatalf("expected invalid for disabled zone, got %v", err)
	}
}

func TestIngressProjectAdminBypass(t *testing.T) {
	app, owner := setupApp(t)
	ctx := context.Background()
	ws, _, adminUser := seedIngressWS(t, app, owner)

	r, err := app.CreateIngress(ctx, CreateIngressInput{
		WorkspaceID: ws.ID, Domain: "admin-direct.example.org",
		Port: 8080, Actor: *adminUser,
	})
	if err != nil {
		t.Fatal(err)
	}
	if r.Status != models.IngressActive {
		t.Fatalf("project admin should bypass approval, got %s", r.Status)
	}
}
