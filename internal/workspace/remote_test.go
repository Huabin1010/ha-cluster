package workspace

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
)

type dummyFinder struct {
	node models.Node
	ws   models.Workspace
}

func (d *dummyFinder) GetNode(_ context.Context, _ uuid.UUID) (*models.Node, error) {
	return &d.node, nil
}

func (d *dummyFinder) GetWorkspace(_ context.Context, _ uuid.UUID) (*models.Workspace, error) {
	return &d.ws, nil
}

func TestRemoteAgentRuntime(t *testing.T) {
	wsID := uuid.New()
	nodeID := uuid.New()

	// Mock agent HTTP server
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("X-HA-Node-Token")
		if token != "secret" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/v1/workspaces/launch":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(Instance{
				ID:      wsID,
				NodeID:  nodeID,
				SSHPort: 22,
				Running: true,
			})
		case "/v1/workspaces/stop":
			w.WriteHeader(http.StatusOK)
		case "/v1/workspaces/start":
			w.WriteHeader(http.StatusOK)
		case "/v1/workspaces/resize":
			w.WriteHeader(http.StatusOK)
		case "/v1/workspaces/destroy":
			w.WriteHeader(http.StatusOK)
		case "/v1/workspaces/get":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(Instance{
				ID:      wsID,
				NodeID:  nodeID,
				SSHPort: 22,
				Running: true,
			})
		case "/v1/workspaces/expose-port":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]int{"host_port": 24001})
		case "/v1/workspaces/unexpose-port":
			w.WriteHeader(http.StatusOK)
		case "/v1/workspaces/sync-keys":
			w.WriteHeader(http.StatusOK)
		default:
			http.NotFound(w, r)
		}
	})

	ts := httptest.NewServer(handler)
	defer ts.Close()

	u, err := url.Parse(ts.URL)
	if err != nil {
		t.Fatalf("parse test server url: %v", err)
	}
	host := u.Hostname()
	port, _ := strconv.Atoi(u.Port())

	node := models.Node{
		ID:       nodeID,
		Name:     "worker-test",
		FabricIP: host,
	}
	ws := models.Workspace{
		ID:       wsID,
		NodeID:   nodeID,
		Plan:     "nano",
		CPUMilli: 500,
	}

	finder := &dummyFinder{node: node, ws: ws}
	rt := NewRemoteAgentRuntime(finder, "secret", NewMemoryRuntime())
	rt.Port = port

	ctx := context.Background()

	// 1. Launch
	inst, err := rt.Launch(ctx, ws, node, []string{"ssh-ed25519 key"})
	if err != nil {
		t.Fatalf("Launch failed: %v", err)
	}
	if inst.ID != wsID || !inst.Running {
		t.Fatalf("unexpected instance: %+v", inst)
	}

	// 2. Stop
	if err := rt.Stop(ctx, wsID); err != nil {
		t.Fatalf("Stop failed: %v", err)
	}

	// 3. Start
	if err := rt.Start(ctx, wsID); err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	// 4. Resize
	if err := rt.Resize(ctx, ws); err != nil {
		t.Fatalf("Resize failed: %v", err)
	}

	// 5. Get
	instGet, ok := rt.Get(ctx, wsID)
	if !ok || instGet.ID != wsID {
		t.Fatalf("Get failed: ok=%v, inst=%+v", ok, instGet)
	}

	// 6. ExposePort & UnexposePort
	routeID := uuid.New()
	hp, err := rt.ExposePort(ctx, wsID, routeID, 8080)
	if err != nil {
		t.Fatalf("ExposePort failed: %v", err)
	}
	if hp != 24001 {
		t.Fatalf("expected host port 24001, got %d", hp)
	}
	if err := rt.UnexposePort(ctx, wsID, routeID); err != nil {
		t.Fatalf("UnexposePort failed: %v", err)
	}

	// 7. SyncKeys
	if err := rt.SyncKeys(ctx, wsID, []string{"ssh-ed25519 newkey"}); err != nil {
		t.Fatalf("SyncKeys failed: %v", err)
	}

	// 8. Destroy
	if err := rt.Destroy(ctx, wsID); err != nil {
		t.Fatalf("Destroy failed: %v", err)
	}

	// 9. Fallback local when FabricIP is empty
	localNode := models.Node{ID: uuid.New(), Name: "local", FabricIP: ""}
	localWS := models.Workspace{ID: uuid.New(), NodeID: localNode.ID}
	localInst, err := rt.Launch(ctx, localWS, localNode, nil)
	if err != nil {
		t.Fatalf("fallback Launch failed: %v", err)
	}
	if localInst.ID != localWS.ID {
		t.Fatalf("fallback unexpected: %+v", localInst)
	}
}
