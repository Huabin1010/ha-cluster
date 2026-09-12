package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"
	"time"

	"ha-cluster/internal/models"
	"ha-cluster/internal/workspace"
)

func TestDefaultIdleSuspendHoursOff(t *testing.T) {
	t.Setenv("HA_IDLE_SUSPEND_HOURS", "")
	if got := defaultIdleSuspendHours(); got != 0 {
		t.Fatalf("expected default 0 (disabled), got %d", got)
	}
}

func TestSuspendIdleWorkspacesDisabledByDefault(t *testing.T) {
	t.Setenv("HA_IDLE_SUSPEND_HOURS", "")
	app, u := setupApp(t)
	ctx := context.Background()

	p, err := app.CreateProject(ctx, u.ID, "idle-off", "idle-off")
	if err != nil {
		t.Fatal(err)
	}
	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "dev", Plan: "nano", Arch: models.ArchAMD64, Actor: *u,
	})
	if err != nil {
		t.Fatal(err)
	}
	ws.LastActivityAt = time.Now().Add(-48 * time.Hour)
	ws.UpdatedAt = ws.LastActivityAt
	if err := app.Store.UpdateWorkspace(ctx, ws); err != nil {
		t.Fatal(err)
	}

	n, err := app.SuspendIdleWorkspaces(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("expected 0 suspended when idle disabled, got %d", n)
	}
	got, err := app.Store.GetWorkspace(ctx, ws.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != models.WSRunning {
		t.Fatalf("expected still running, got %s", got.Status)
	}
}

func TestSuspendIdleWorkspacesWhenWorkspaceHoursSet(t *testing.T) {
	t.Setenv("HA_IDLE_SUSPEND_HOURS", "")
	app, u := setupApp(t)
	ctx := context.Background()

	p, err := app.CreateProject(ctx, u.ID, "idle-on", "idle-on")
	if err != nil {
		t.Fatal(err)
	}
	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "dev", Plan: "nano", Arch: models.ArchAMD64, Actor: *u,
	})
	if err != nil {
		t.Fatal(err)
	}
	ws.IdleSuspendHours = 1
	ws.LastActivityAt = time.Now().Add(-2 * time.Hour)
	ws.UpdatedAt = ws.LastActivityAt
	if err := app.Store.UpdateWorkspace(ctx, ws); err != nil {
		t.Fatal(err)
	}

	n, err := app.SuspendIdleWorkspaces(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("expected 1 suspended, got %d", n)
	}
	got, err := app.Store.GetWorkspace(ctx, ws.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != models.WSSuspended {
		t.Fatalf("expected suspended, got %s", got.Status)
	}

	audits, err := app.Store.ListAuditByResource(ctx, ws.ID.String(), 20)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, a := range audits {
		if a.Action != "workspace.idle_suspend" {
			continue
		}
		found = true
		switch v := a.Meta["idle_hours"].(type) {
		case int:
			if v != 1 {
				t.Fatalf("expected idle_hours=1, got %v", v)
			}
		case int64:
			if v != 1 {
				t.Fatalf("expected idle_hours=1, got %v", v)
			}
		case float64:
			if v != 1 {
				t.Fatalf("expected idle_hours=1, got %v", v)
			}
		default:
			t.Fatalf("expected idle_hours=1, got %v (%T)", a.Meta["idle_hours"], a.Meta["idle_hours"])
		}
	}
	if !found {
		t.Fatal("expected workspace.idle_suspend audit")
	}
}

func TestSuspendIdleWorkspacesWhenEnvHoursSet(t *testing.T) {
	t.Setenv("HA_IDLE_SUSPEND_HOURS", "1")
	app, u := setupApp(t)
	ctx := context.Background()

	p, err := app.CreateProject(ctx, u.ID, "idle-env", "idle-env")
	if err != nil {
		t.Fatal(err)
	}
	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "dev", Plan: "nano", Arch: models.ArchAMD64, Actor: *u,
	})
	if err != nil {
		t.Fatal(err)
	}
	ws.LastActivityAt = time.Now().Add(-2 * time.Hour)
	ws.UpdatedAt = ws.LastActivityAt
	if err := app.Store.UpdateWorkspace(ctx, ws); err != nil {
		t.Fatal(err)
	}

	n, err := app.SuspendIdleWorkspaces(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("expected 1 suspended via env, got %d", n)
	}
}

func TestInstanceStatusPreservesSuspended(t *testing.T) {
	if got := instanceStatus(false, models.WSSuspended); got != models.WSSuspended {
		t.Fatalf("got %s", got)
	}
	if got := instanceStatus(false, models.WSRunning); got != models.WSStopped {
		t.Fatalf("got %s", got)
	}
	if got := instanceStatus(true, models.WSSuspended); got != models.WSRunning {
		t.Fatalf("got %s", got)
	}
}

func TestReconcileWorkspaceHealthKeepsSuspended(t *testing.T) {
	app, u := setupApp(t)
	ctx := context.Background()
	const Gi = 1024 * 1024 * 1024

	p, err := app.CreateProject(ctx, u.ID, "susp", "susp")
	if err != nil {
		t.Fatal(err)
	}
	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "dev", Plan: "nano", Arch: models.ArchAMD64, Actor: *u,
	})
	if err != nil {
		t.Fatal(err)
	}

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/workspaces/get" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(workspace.Instance{
				ID: ws.ID, NodeID: ws.NodeID, SSHPort: 22, Running: false,
			})
			return
		}
		http.NotFound(w, r)
	})
	ts := httptest.NewServer(handler)
	t.Cleanup(ts.Close)
	uURL, err := url.Parse(ts.URL)
	if err != nil {
		t.Fatal(err)
	}
	port, _ := strconv.Atoi(uURL.Port())

	n, err := app.Store.GetNode(ctx, ws.NodeID)
	if err != nil {
		t.Fatal(err)
	}
	n.HealthStatus = models.NodeHealthy
	n.Ready = true
	n.FabricIP = uURL.Hostname()
	n.AllocatableCPU = 8000
	n.AllocatableMem = 2 * Gi
	n.AllocatableDisk = 100 * Gi
	if err := app.Store.UpsertNode(ctx, n); err != nil {
		t.Fatal(err)
	}

	ws.Status = models.WSSuspended
	if err := app.Store.UpdateWorkspace(ctx, ws); err != nil {
		t.Fatal(err)
	}

	rem := workspace.NewRemoteAgentRuntime(app.Store, "token", workspace.NewMemoryRuntime())
	rem.Port = port
	app.Runtime = rem

	updated, err := app.ReconcileWorkspaceHealth(ctx)
	if err != nil {
		t.Fatal(err)
	}
	got, err := app.Store.GetWorkspace(ctx, ws.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != models.WSSuspended {
		t.Fatalf("expected suspended preserved (updated=%d), got %s", updated, got.Status)
	}
}
