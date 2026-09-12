package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
	"ha-cluster/internal/store/memory"
	"ha-cluster/internal/webshell"
	"ha-cluster/internal/workspace"

	"github.com/google/uuid"
)

func setupApp(t *testing.T) (*App, *models.User) {
	t.Helper()
	t.Setenv("HA_PROVISION_SYNC", "1")
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
	got, _ := app.Store.GetWorkspace(ctx, ws.ID)
	if got.Status != models.WSDestroyed {
		t.Fatalf("platform admin should destroy immediately, got %s", got.Status)
	}
	nodes, _ = app.Store.ListNodes(ctx)
	if nodes[0].UsedMem != 0 {
		t.Fatalf("used mem after destroy %d", nodes[0].UsedMem)
	}
}

func TestCreateWorkspaceRollbackOnRuntimeFailure(t *testing.T) {
	t.Setenv("HA_PROVISION_SYNC", "1")
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
	logs, err := app.Store.ListAudit(ctx, 50)
	if err != nil {
		t.Fatal(err)
	}
	var resizeLog *models.AuditLog
	for i := range logs {
		if logs[i].Action == "workspace.resize.request" {
			resizeLog = &logs[i]
		}
	}
	if resizeLog == nil {
		t.Fatal("missing workspace.resize.request audit")
	}
	if resizeLog.Meta["kind"] != models.ResizeDowngrade {
		t.Fatalf("kind=%v", resizeLog.Meta["kind"])
	}
	if resizeLog.Meta["from_disk_bytes"] != cur.DiskBytes || resizeLog.Meta["to_disk_bytes"] != Gi {
		t.Fatalf("disk meta=%#v", resizeLog.Meta)
	}
	if resizeLog.Meta["workspace_name"] != "box" {
		t.Fatalf("name=%v", resizeLog.Meta["workspace_name"])
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

func TestRequestResizeSkipsApprovalForAdmins(t *testing.T) {
	app, owner := setupApp(t)
	ctx := context.Background()
	p, _ := app.CreateProject(ctx, owner.ID, "p-rsz", "p-rsz")
	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "admin-box", Plan: "nano", Arch: models.ArchAMD64, Actor: *owner,
	})
	if err != nil {
		t.Fatal(err)
	}
	const Mi = int64(1024 * 1024)
	const Gi = 1024 * Mi
	out, err := app.RequestResize(ctx, *owner, ws.ID, 1000, 512*Mi, 5*Gi)
	if err != nil {
		t.Fatal(err)
	}
	if out.HasPendingResize() {
		t.Fatal("project owner / platform admin must apply resize immediately")
	}
	if out.CPUMilli != 1000 || out.MemBytes != 512*Mi {
		t.Fatalf("want applied spec, got %+v", out)
	}

	projOwner, err := app.Register(ctx, "rszown", "rszown@example.com", "password1")
	if err != nil {
		t.Fatal(err)
	}
	p2, err := app.CreateProject(ctx, projOwner.ID, "p-own", "p-own")
	if err != nil {
		t.Fatal(err)
	}
	ws2, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p2.ID, Name: "own-box", Plan: "nano", Arch: models.ArchAMD64, Actor: *projOwner,
	})
	if err != nil {
		t.Fatal(err)
	}
	applied, err := app.RequestResize(ctx, *projOwner, ws2.ID, 1000, 512*Mi, 5*Gi)
	if err != nil {
		t.Fatal(err)
	}
	if applied.HasPendingResize() || applied.CPUMilli != 1000 {
		t.Fatalf("project owner want immediate apply, got %+v", applied)
	}

	down, err := app.RequestResize(ctx, *projOwner, ws2.ID, 500, 256*Mi, 5*Gi)
	if err != nil {
		t.Fatal(err)
	}
	if !down.HasPendingResize() || down.ResizeKind != models.ResizeDowngrade {
		t.Fatalf("downgrade must stay pending for approval, got %+v", down)
	}
	if down.CPUMilli != 1000 {
		t.Fatalf("downgrade must not apply before approve, got %+v", down)
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
	webKey := webshell.AuthorizedKey()
	if webKey == "" {
		t.Fatal("web terminal key missing")
	}
	if !containsKey(keys, key1.PublicKey) || !containsKey(keys, webKey) {
		t.Fatalf("expected user key %q and web terminal key, got %+v", key1.PublicKey, keys)
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
	if !containsKey(keys, key1.PublicKey) || !containsKey(keys, key2.PublicKey) || !containsKey(keys, webKey) {
		t.Fatalf("expected key1, key2 and web terminal key, got %+v", keys)
	}

	// 3. Delete first SSH key
	if err := app.DeleteSSHKey(ctx, owner.ID, key1.ID); err != nil {
		t.Fatalf("DeleteSSHKey failed: %v", err)
	}
	if err := app.SyncUserKeys(ctx, owner.ID); err != nil {
		t.Fatalf("SyncUserKeys failed: %v", err)
	}

	keys = memRt.GetKeys(ws.ID)
	if containsKey(keys, key1.PublicKey) || !containsKey(keys, key2.PublicKey) || !containsKey(keys, webKey) {
		t.Fatalf("expected only key2 %q plus web terminal key, got %+v", key2.PublicKey, keys)
	}
}

func TestRequestDestroySkipsApprovalsForAdmins(t *testing.T) {
	app, plat := setupApp(t)
	ctx := context.Background()

	pDev, err := app.CreateProject(ctx, plat.ID, "skip-dev", "skip-dev")
	if err != nil {
		t.Fatal(err)
	}
	wsDev, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: pDev.ID, Name: "dev-ws", Plan: "nano", Arch: models.ArchAMD64, Actor: *plat,
	})
	if err != nil {
		t.Fatal(err)
	}
	dev, err := app.Register(ctx, "skipdev", "skipdev@example.com", "password1")
	if err != nil {
		t.Fatal(err)
	}
	if err := app.Store.AddMembership(ctx, models.Membership{ProjectID: pDev.ID, UserID: dev.ID, Role: models.RoleDeveloper}); err != nil {
		t.Fatal(err)
	}
	if err := app.RequestDestroyWorkspace(ctx, *dev, wsDev.ID); err != nil {
		t.Fatal(err)
	}
	got, _ := app.Store.GetWorkspace(ctx, wsDev.ID)
	if got.Status != models.WSDestroyRequested {
		t.Fatalf("developer want destroy_requested, got %s", got.Status)
	}

	owner, err := app.Register(ctx, "skipown", "skipown@example.com", "password1")
	if err != nil {
		t.Fatal(err)
	}
	pOwn, err := app.CreateProject(ctx, owner.ID, "skip-own", "skip-own")
	if err != nil {
		t.Fatal(err)
	}
	wsOwn, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: pOwn.ID, Name: "own-ws", Plan: "nano", Arch: models.ArchAMD64, Actor: *owner,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := app.RequestDestroyWorkspace(ctx, *owner, wsOwn.ID); err != nil {
		t.Fatal(err)
	}
	got, _ = app.Store.GetWorkspace(ctx, wsOwn.ID)
	if got.Status != models.WSDestroyPendingPlatform {
		t.Fatalf("project owner want destroy_pending_platform, got %s", got.Status)
	}
	if err := app.ApproveDestroyProject(ctx, *owner, wsOwn.ID); err != nil {
		t.Fatal(err)
	}

	pPlat, err := app.CreateProject(ctx, plat.ID, "skip-plat", "skip-plat")
	if err != nil {
		t.Fatal(err)
	}
	wsPlat, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: pPlat.ID, Name: "plat-ws", Plan: "nano", Arch: models.ArchAMD64, Actor: *plat,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := app.RequestDestroyWorkspace(ctx, *plat, wsPlat.ID); err != nil {
		t.Fatal(err)
	}
	got, _ = app.Store.GetWorkspace(ctx, wsPlat.ID)
	if got.Status != models.WSDestroyed {
		t.Fatalf("platform admin want destroyed, got %s", got.Status)
	}
}

func TestForceDestroyWinsOverLateProvision(t *testing.T) {
	assertForceDestroyBeatsLaunch(t, false)
}

func TestForceDestroyWinsOverLateFailedProvision(t *testing.T) {
	assertForceDestroyBeatsLaunch(t, true)
}

func assertForceDestroyBeatsLaunch(t *testing.T, failLaunch bool) {
	t.Helper()
	rt := workspace.NewBlockableRuntime()
	rt.FailAfter = failLaunch
	st := memory.New()
	app := New(st, rt, []byte("unit-test-secret-key-32b!!"))
	ctx := context.Background()
	u, err := app.Register(ctx, "alice", "alice@example.com", "password1")
	if err != nil {
		t.Fatal(err)
	}
	const Gi = 1024 * 1024 * 1024
	if err := st.UpsertNode(ctx, &models.Node{
		ID: uuid.New(), Name: "pc1", Arch: models.ArchAMD64, Power: "mains", Role: "worker",
		AllocatableCPU: 8000, AllocatableMem: 2 * Gi, AllocatableDisk: 100 * Gi, Ready: true,
	}); err != nil {
		t.Fatal(err)
	}
	p, err := app.CreateProject(ctx, u.ID, "lab", "lab")
	if err != nil {
		t.Fatal(err)
	}

	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "cwp-lab", Plan: "nano", Arch: models.ArchAMD64, Actor: *u,
	})
	if err != nil {
		t.Fatal(err)
	}
	if ws.Status != models.WSProvisioning {
		t.Fatalf("want provisioning, got %s", ws.Status)
	}

	select {
	case <-rt.Started:
	case <-time.After(2 * time.Second):
		t.Fatal("launch did not start")
	}

	if err := app.RequestDestroyWorkspace(ctx, *u, ws.ID); err != nil {
		t.Fatal(err)
	}
	got, _ := app.Store.GetWorkspace(ctx, ws.ID)
	if got.Status != models.WSDestroyed {
		t.Fatalf("destroy want destroyed, got %s", got.Status)
	}

	close(rt.Release)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		got, _ = app.Store.GetWorkspace(ctx, ws.ID)
		if got.Status == models.WSRunning || got.Status == models.WSFailed {
			t.Fatalf("late launch resurrected workspace to %s", got.Status)
		}
		time.Sleep(20 * time.Millisecond)
	}

	got, _ = app.Store.GetWorkspace(ctx, ws.ID)
	if got.Status != models.WSDestroyed {
		t.Fatalf("late launch must not resurrect workspace, got %s", got.Status)
	}
	if _, ok := rt.Get(ctx, ws.ID); ok {
		t.Fatal("late launch instance must be destroyed")
	}
}

type getHookStore struct {
	store.Store
	onGet func(*models.Workspace)
}

func (s *getHookStore) GetWorkspace(ctx context.Context, id uuid.UUID) (*models.Workspace, error) {
	w, err := s.Store.GetWorkspace(ctx, id)
	if err == nil && s.onGet != nil {
		s.onGet(w)
	}
	return w, err
}

func TestForceDestroyWinsOverProvisionCommitRace(t *testing.T) {
	inner := memory.New()
	hs := &getHookStore{Store: inner}
	rt := workspace.NewMemoryRuntime()
	app := New(hs, rt, []byte("unit-test-secret-key-32b!!"))
	ctx := context.Background()
	u, err := app.Register(ctx, "alice", "alice@example.com", "password1")
	if err != nil {
		t.Fatal(err)
	}
	const Gi = 1024 * 1024 * 1024
	if err := inner.UpsertNode(ctx, &models.Node{
		ID: uuid.New(), Name: "pc1", Arch: models.ArchAMD64, Power: "mains", Role: "worker",
		AllocatableCPU: 8000, AllocatableMem: 2 * Gi, AllocatableDisk: 100 * Gi, Ready: true,
	}); err != nil {
		t.Fatal(err)
	}
	p, err := app.CreateProject(ctx, u.ID, "lab", "lab")
	if err != nil {
		t.Fatal(err)
	}

	var gets int
	hs.onGet = func(w *models.Workspace) {
		if w.Name != "cwp-cas" || w.Status != models.WSProvisioning {
			return
		}
		gets++
		if gets == 2 {
			if err := app.RequestDestroyWorkspace(context.Background(), *u, w.ID); err != nil {
				t.Errorf("destroy during commit: %v", err)
			}
		}
	}

	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "cwp-cas", Plan: "nano", Arch: models.ArchAMD64, Actor: *u,
	})
	if err != nil {
		t.Fatal(err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		got, _ := app.Store.GetWorkspace(ctx, ws.ID)
		if got.Status == models.WSRunning || got.Status == models.WSFailed {
			t.Fatalf("commit race resurrected workspace to %s", got.Status)
		}
		if got.Status == models.WSDestroyed {
			if _, ok := rt.Get(ctx, ws.ID); ok {
				time.Sleep(20 * time.Millisecond)
				continue
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	got, _ := app.Store.GetWorkspace(ctx, ws.ID)
	t.Fatalf("want destroyed after commit race, got %s", got.Status)
}

func containsKey(keys []string, want string) bool {
	for _, k := range keys {
		if k == want {
			return true
		}
	}
	return false
}
