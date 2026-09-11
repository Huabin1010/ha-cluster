package service

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/workspace"
)

func TestReconcileWorkspaceHealthNodeOffline(t *testing.T) {
	app, u := setupApp(t)
	ctx := context.Background()
	const Gi = 1024 * 1024 * 1024

	n := models.Node{
		ID: uuid.New(), Name: "pc-offline", Arch: models.ArchAMD64, Power: "mains", Role: "worker",
		AllocatableCPU: 8000, AllocatableMem: 2 * Gi, AllocatableDisk: 100 * Gi,
		Ready: false, HealthStatus: models.NodeOffline, FabricIP: "10.88.0.11",
	}
	if err := app.Store.UpsertNode(ctx, &n); err != nil {
		t.Fatal(err)
	}

	p, err := app.CreateProject(ctx, u.ID, "lost", "lost")
	if err != nil {
		t.Fatal(err)
	}
	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "dev", Plan: "large", Arch: models.ArchAMD64, Actor: *u,
	})
	if err != nil {
		t.Fatal(err)
	}
	ws.NodeID = n.ID
	if err := app.Store.UpdateWorkspace(ctx, ws); err != nil {
		t.Fatal(err)
	}

	updated, err := app.ReconcileWorkspaceHealth(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if updated != 1 {
		t.Fatalf("expected 1 update, got %d", updated)
	}
	got, err := app.Store.GetWorkspace(ctx, ws.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != models.WSNodeLost {
		t.Fatalf("expected node_lost, got %s", got.Status)
	}
}

func TestRefreshNodeHealthAgentProbeMarksOffline(t *testing.T) {
	app, u := setupApp(t)
	ctx := context.Background()
	const Gi = 1024 * 1024 * 1024

	nodes, err := app.Store.ListNodes(ctx)
	if err != nil || len(nodes) == 0 {
		t.Fatal(err)
	}
	nodes[0].LastHeartbeat = time.Now()
	nodes[0].HealthStatus = models.NodeHealthy
	nodes[0].Ready = true
	if err := app.Store.UpsertNode(ctx, &nodes[0]); err != nil {
		t.Fatal(err)
	}

	p, err := app.CreateProject(ctx, u.ID, "probe", "probe")
	if err != nil {
		t.Fatal(err)
	}
	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "dev", Plan: "large", Arch: models.ArchAMD64, Actor: *u,
	})
	if err != nil {
		t.Fatal(err)
	}

	rem := workspace.NewRemoteAgentRuntime(app.Store, "token", workspace.NewMemoryRuntime())
	app.Runtime = rem

	_, offline, err := app.RefreshNodeHealth(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if offline == 0 {
		t.Fatal("expected node marked offline when agent unreachable")
	}

	got, err := app.Store.GetWorkspace(ctx, ws.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != models.WSNodeLost {
		t.Fatalf("expected node_lost after probe, got %s", got.Status)
	}
}

func TestReconcileWorkspaceHealthRecoversNodeLost(t *testing.T) {
	app, u := setupApp(t)
	ctx := context.Background()
	const Gi = 1024 * 1024 * 1024

	n := models.Node{
		ID: uuid.New(), Name: "pc-back", Arch: models.ArchAMD64, Power: "mains", Role: "worker",
		AllocatableCPU: 8000, AllocatableMem: 2 * Gi, AllocatableDisk: 100 * Gi,
		Ready: true, HealthStatus: models.NodeHealthy, FabricIP: "10.88.0.12",
	}
	if err := app.Store.UpsertNode(ctx, &n); err != nil {
		t.Fatal(err)
	}
	p, err := app.CreateProject(ctx, u.ID, "back", "back")
	if err != nil {
		t.Fatal(err)
	}
	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "dev", Plan: "large", Arch: models.ArchAMD64, Actor: *u,
	})
	if err != nil {
		t.Fatal(err)
	}
	ws.NodeID = n.ID
	ws.Status = models.WSNodeLost
	if err := app.Store.UpdateWorkspace(ctx, ws); err != nil {
		t.Fatal(err)
	}

	updated, err := app.ReconcileWorkspaceHealth(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if updated != 1 {
		t.Fatalf("expected 1 update, got %d", updated)
	}
	got, err := app.Store.GetWorkspace(ctx, ws.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != models.WSRunning {
		t.Fatalf("expected running after node healthy, got %s", got.Status)
	}
}

