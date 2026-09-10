package service

import (
	"context"
	"errors"
	"strings"
	"testing"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
	"ha-cluster/internal/store/memory"
	"ha-cluster/internal/workspace"

	"github.com/google/uuid"
)

func setupApp(t *testing.T) (*App, *models.User) {
	t.Helper()
	st := memory.New()
	app := New(st, workspace.NewMemoryRuntime(), []byte("unit-test-secret-key-32b!!"))
	u, err := app.Register(context.Background(), "alice", "alice@example.com", "password1")
	if err != nil {
		t.Fatal(err)
	}
	const Gi = 1024 * 1024 * 1024
	n := models.Node{
		ID: uuid.New(), Name: "pc1", Arch: models.ArchAMD64, Power: "mains", Role: "worker",
		AllocatableCPU: 8000, AllocatableMem: 2 * Gi, AllocatableDisk: 100 * Gi, Ready: true, FabricIP: "10.88.0.10",
	}
	if err := st.UpsertNode(context.Background(), &n); err != nil {
		t.Fatal(err)
	}
	return app, u
}

func TestRegisterLoginAndDuplicate(t *testing.T) {
	app, u := setupApp(t)
	if u.Username != "alice" {
		t.Fatal(u)
	}
	tok, got, err := app.Login(context.Background(), "alice", "password1")
	if err != nil || tok == "" || got.ID != u.ID {
		t.Fatalf("%v %s", err, tok)
	}
	if _, _, err := app.Login(context.Background(), "alice", "nope"); !errors.Is(err, store.ErrUnauthorized) {
		t.Fatal(err)
	}
	if _, err := app.Register(context.Background(), "alice", "other@x.com", "password1"); !errors.Is(err, store.ErrConflict) {
		t.Fatal(err)
	}
}

func TestCreateWorkspaceOccupiesAndRelease(t *testing.T) {
	app, u := setupApp(t)
	ctx := context.Background()
	p, err := app.CreateProject(ctx, u.ID, "demo", "demo")
	if err != nil {
		t.Fatal(err)
	}
	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "dev", Plan: "large", Arch: models.ArchAMD64, Actor: *u,
	})
	if err != nil {
		t.Fatal(err)
	}
	if ws.Status != models.WSRunning || ws.SSHPort == 0 {
		t.Fatalf("%+v", ws)
	}
	nodes, _ := app.Store.ListNodes(ctx)
	if nodes[0].UsedMem == 0 {
		t.Fatal("must occupy memory")
	}
	if err := app.RequestDestroyWorkspace(ctx, *u, ws.ID); err != nil {
		t.Fatal(err)
	}
	if err := app.ApproveDestroyProject(ctx, *u, ws.ID); err != nil {
		t.Fatal(err)
	}
	if err := app.ApproveDestroyPlatform(ctx, *u, ws.ID); err != nil {
		t.Fatal(err)
	}
	nodes, _ = app.Store.ListNodes(ctx)
	if nodes[0].UsedMem != 0 {
		t.Fatalf("used mem after destroy %d", nodes[0].UsedMem)
	}
}

func TestCreateWorkspaceRollbackOnRuntimeFailure(t *testing.T) {
	st := memory.New()
	app := New(st, workspace.FailLaunchOnce(), []byte("unit-test-secret-key-32b!!"))
	u, _ := app.Register(context.Background(), "bob", "bob@example.com", "password1")
	const Gi = 1024 * 1024 * 1024
	_ = st.UpsertNode(context.Background(), &models.Node{
		ID: uuid.New(), Name: "pc1", Arch: models.ArchAMD64, Role: "worker",
		AllocatableCPU: 8000, AllocatableMem: 8 * Gi, AllocatableDisk: 100 * Gi, Ready: true,
	})
	p, _ := app.CreateProject(context.Background(), u.ID, "p", "p")
	_, err := app.CreateWorkspace(context.Background(), CreateWorkspaceInput{
		ProjectID: p.ID, Plan: "small", Arch: models.ArchAMD64, Actor: *u,
	})
	if err == nil {
		t.Fatal("expected provision error")
	}
	nodes, _ := st.ListNodes(context.Background())
	if nodes[0].UsedCPU != 0 || nodes[0].UsedMem != 0 {
		t.Fatalf("must roll back occupancy: %+v", nodes[0])
	}
}

func TestViewerCannotCreateWorkspace(t *testing.T) {
	app, owner := setupApp(t)
	ctx := context.Background()
	p, _ := app.CreateProject(ctx, owner.ID, "p", "p")
	viewer, _ := app.Register(ctx, "carol", "carol@example.com", "password1")
	_ = app.Store.AddMembership(ctx, models.Membership{ProjectID: p.ID, UserID: viewer.ID, Role: models.RoleViewer})
	_, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Plan: "nano", Arch: models.ArchAMD64, Actor: *viewer,
	})
	if !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("got %v", err)
	}
}

func TestPrivateWorkspaceSSHACL(t *testing.T) {
	app, owner := setupApp(t)
	ctx := context.Background()
	p, _ := app.CreateProject(ctx, owner.ID, "p", "p")
	dev, _ := app.Register(ctx, "dev", "dev@example.com", "password1")
	_ = app.Store.AddMembership(ctx, models.Membership{ProjectID: p.ID, UserID: dev.ID, Role: models.RoleDeveloper})
	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "mine", Plan: "nano", Arch: models.ArchAMD64,
		Visibility: models.VisPrivate, Actor: *owner,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := app.SSHTarget(ctx, *dev, ws.ID); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("dev should not enter private ws: %v", err)
	}
	if _, _, err := app.SSHTarget(ctx, *owner, ws.ID); err != nil {
		t.Fatal(err)
	}
}

func TestStopDoesNotReleaseQuota(t *testing.T) {
	app, u := setupApp(t)
	ctx := context.Background()
	p, _ := app.CreateProject(ctx, u.ID, "p", "p")
	ws, _ := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Plan: "large", Arch: models.ArchAMD64, Actor: *u,
	})
	if err := app.StopWorkspace(ctx, *u, ws.ID); err != nil {
		t.Fatal(err)
	}
	_, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "other", Plan: "large", Arch: models.ArchAMD64, Actor: *u,
	})
	if !errors.Is(err, store.ErrNoCapacity) {
		t.Fatalf("stopped ws must keep quota, got %v", err)
	}
}

func TestDeveloperRequestNeedsApproval(t *testing.T) {
	app, owner := setupApp(t)
	ctx := context.Background()
	p, _ := app.CreateProject(ctx, owner.ID, "p", "p")
	dev, _ := app.Register(ctx, "devreq", "devreq@example.com", "password1")
	_ = app.Store.AddMembership(ctx, models.Membership{
		ProjectID: p.ID, UserID: dev.ID, Role: models.RoleDeveloper, SSHAccess: models.SSHAccessGranted,
	})

	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "need-ok", Plan: "nano", Arch: models.ArchAMD64, Actor: *dev,
	})
	if err != nil {
		t.Fatal(err)
	}
	if ws.Status != models.WSRequested {
		t.Fatalf("developer must wait for approval, got %s", ws.Status)
	}
	nodes, _ := app.Store.ListNodes(ctx)
	if nodes[0].UsedMem != 0 {
		t.Fatal("request must not occupy capacity")
	}
	if _, _, err := app.SSHTarget(ctx, *dev, ws.ID); err == nil {
		t.Fatal("ssh before approve must fail")
	}

	if _, err := app.ApproveWorkspace(ctx, *dev, ws.ID); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("developer cannot approve, got %v", err)
	}

	got, err := app.ApproveWorkspace(ctx, *owner, ws.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != models.WSRunning || got.SSHPort == 0 {
		t.Fatalf("%+v", got)
	}
	nodes, _ = app.Store.ListNodes(ctx)
	if nodes[0].UsedMem == 0 {
		t.Fatal("approve must occupy capacity")
	}
	if _, _, err := app.SSHTarget(ctx, *dev, ws.ID); err != nil {
		t.Fatal(err)
	}
}

func TestRejectWorkspaceRequest(t *testing.T) {
	app, owner := setupApp(t)
	ctx := context.Background()
	p, _ := app.CreateProject(ctx, owner.ID, "p", "p")
	dev, _ := app.Register(ctx, "devrej", "devrej@example.com", "password1")
	_ = app.Store.AddMembership(ctx, models.Membership{ProjectID: p.ID, UserID: dev.ID, Role: models.RoleDeveloper})
	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "nope", Plan: "nano", Arch: models.ArchAMD64, Actor: *dev,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := app.RejectWorkspace(ctx, *owner, ws.ID, "quota"); err != nil {
		t.Fatal(err)
	}
	got, _ := app.Store.GetWorkspace(ctx, ws.ID)
	if got.Status != models.WSRejected {
		t.Fatalf("%s", got.Status)
	}
	if _, err := app.ApproveWorkspace(ctx, *owner, ws.ID); !errors.Is(err, store.ErrInvalidInput) {
		t.Fatalf("rejected cannot be approved, got %v", err)
	}
}

func TestResizeRequestApproveAndNoDiskShrink(t *testing.T) {
	app, owner := setupApp(t)
	ctx := context.Background()
	p, _ := app.CreateProject(ctx, owner.ID, "p", "p")
	dev, _ := app.Register(ctx, "devrs", "devrs@example.com", "password1")
	_ = app.Store.AddMembership(ctx, models.Membership{
		ProjectID: p.ID, UserID: dev.ID, Role: models.RoleDeveloper, SSHAccess: models.SSHAccessGranted,
	})

	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "box", Plan: "nano", Arch: models.ArchAMD64, Actor: *owner,
	})
	if err != nil {
		t.Fatal(err)
	}

	const Mi = int64(1024 * 1024)
	const Gi = 1024 * Mi
	cur := ws.Spec()
	down, err := app.RequestResize(ctx, *dev, ws.ID, cur.CPUMilli, cur.MemBytes, Gi)
	if err != nil {
		t.Fatalf("disk downgrade request: %v", err)
	}
	if down.ResizeKind != models.ResizeDowngrade {
		t.Fatalf("want downgrade kind, got %s", down.ResizeKind)
	}
	if _, err := app.ApproveResize(ctx, *owner, ws.ID); err != nil {
		t.Fatalf("approve downgrade: %v", err)
	}
	ws, _ = app.Store.GetWorkspace(ctx, ws.ID)
	cur = ws.Spec()

	got, err := app.RequestResize(ctx, *dev, ws.ID, 2000, 2*Gi, 5*Gi)
	if err != nil {
		t.Fatal(err)
	}
	if !got.HasPendingResize() || got.PendingCPUMilli != 2000 {
		t.Fatalf("%+v", got)
	}
	if _, _, err := app.SSHTarget(ctx, *dev, ws.ID); err != nil {
		t.Fatal("ssh still allowed while resize pending")
	}

	if _, err := app.ApproveResize(ctx, *dev, ws.ID); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("developer cannot approve resize, got %v", err)
	}
	out, err := app.ApproveResize(ctx, *owner, ws.ID)
	if err != nil {
		t.Fatal(err)
	}
	if out.HasPendingResize() || out.CPUMilli != 2000 || out.MemBytes != 2*Gi {
		t.Fatalf("%+v", out)
	}
	al, err := app.Store.GetAllocation(ctx, out.AllocationID)
	if err != nil || al.CPUMilli != 2000 || al.MemBytes != 2*Gi {
		t.Fatalf("allocation not expanded: %+v %v", al, err)
	}
}

func TestIngressOnePortThenSecondNeedsConfirm(t *testing.T) {
	app, owner := setupApp(t)
	ctx := context.Background()
	p, _ := app.CreateProject(ctx, owner.ID, "p", "p")
	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "web", Plan: "nano", Arch: models.ArchAMD64, Actor: *owner,
	})
	if err != nil {
		t.Fatal(err)
	}
	r1, err := app.CreateIngress(ctx, CreateIngressInput{
		WorkspaceID: ws.ID, Domain: "app.example.com", Port: 8080, Actor: *owner,
	})
	if err != nil || r1.Preset != models.IngressNocache {
		t.Fatalf("%v %+v", err, r1)
	}
	if !strings.Contains(r1.NginxPreview, "3600s") || !strings.Contains(r1.NginxPreview, "no-cache") {
		t.Fatalf("default nocache preview: %s", r1.NginxPreview)
	}
	_, err = app.CreateIngress(ctx, CreateIngressInput{
		WorkspaceID: ws.ID, Domain: "svc2.example.com", Port: 3000, Actor: *owner,
	})
	if !errors.Is(err, store.ErrSecondPort) {
		t.Fatalf("want second port confirm, got %v", err)
	}
	r2, err := app.CreateIngress(ctx, CreateIngressInput{
		WorkspaceID: ws.ID, Domain: "svc2.example.com", Port: 3000, ConfirmSecondPort: true, Actor: *owner,
	})
	if err != nil {
		t.Fatal(err)
	}
	if r2.Port != 3000 {
		t.Fatal(r2)
	}
	// same port, another domain — no confirm
	if _, err := app.CreateIngress(ctx, CreateIngressInput{
		WorkspaceID: ws.ID, Domain: "www.example.com", Port: 8080, Actor: *owner,
	}); err != nil {
		t.Fatal(err)
	}
}

func TestSSHKeySyncToWorkspaces(t *testing.T) {
	app, owner := setupApp(t)
	ctx := context.Background()
	p, err := app.CreateProject(ctx, owner.ID, "keys-proj", "keys-slug")
	if err != nil {
		t.Fatal(err)
	}

	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "keys-ws", Plan: "nano", Arch: models.ArchAMD64, Actor: *owner,
	})
	if err != nil {
		t.Fatal(err)
	}

	// 1. Add first SSH key
	key1, err := app.AddSSHKey(ctx, owner.ID, "laptop", "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIkey1 key1@test")
	if err != nil {
		t.Fatalf("AddSSHKey failed: %v", err)
	}

	// Sync keys synchronously to verify
	if err := app.SyncUserKeys(ctx, owner.ID); err != nil {
		t.Fatalf("SyncUserKeys failed: %v", err)
	}

	memRt, ok := app.Runtime.(*workspace.MemoryRuntime)
	if !ok {
		t.Fatal("expected MemoryRuntime")
	}

	keys := memRt.GetKeys(ws.ID)
	if len(keys) != 1 || keys[0] != key1.PublicKey {
		t.Fatalf("expected 1 key %q, got %+v", key1.PublicKey, keys)
	}

	// 2. Add second SSH key
	key2, err := app.AddSSHKey(ctx, owner.ID, "desktop", "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIkey2 key2@test")
	if err != nil {
		t.Fatalf("AddSSHKey failed: %v", err)
	}
	if err := app.SyncUserKeys(ctx, owner.ID); err != nil {
		t.Fatalf("SyncUserKeys failed: %v", err)
	}

	keys = memRt.GetKeys(ws.ID)
	if len(keys) != 2 {
		t.Fatalf("expected 2 keys, got %+v", keys)
	}

	// 3. Delete first SSH key
	if err := app.DeleteSSHKey(ctx, owner.ID, key1.ID); err != nil {
		t.Fatalf("DeleteSSHKey failed: %v", err)
	}
	if err := app.SyncUserKeys(ctx, owner.ID); err != nil {
		t.Fatalf("SyncUserKeys failed: %v", err)
	}

	keys = memRt.GetKeys(ws.ID)
	if len(keys) != 1 || keys[0] != key2.PublicKey {
		t.Fatalf("expected only key2 %q, got %+v", key2.PublicKey, keys)
	}
}
