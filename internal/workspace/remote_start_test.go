package workspace

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
)

func TestIncusAlreadyRunningDetection(t *testing.T) {
	if !incusAlreadyRunning("Error: The instance is already running\n") {
		t.Fatal("expected already running")
	}
	if incusAlreadyRunning("Error: The incus daemon doesn't appear to be started") {
		t.Fatal("daemon missing must not look like already running")
	}
}

func TestRemoteStartDoesNotFallBackToLocalIncus(t *testing.T) {
	wsID := uuid.New()
	nodeID := uuid.New()

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/workspaces/start" {
			http.Error(w, `{"error":"incus start: exit status 1: Error: The instance is already running\n"}`, http.StatusInternalServerError)
			return
		}
		http.NotFound(w, r)
	})
	ts := httptest.NewServer(handler)
	t.Cleanup(ts.Close)
	u, err := url.Parse(ts.URL)
	if err != nil {
		t.Fatal(err)
	}
	port, _ := strconv.Atoi(u.Port())

	node := models.Node{ID: nodeID, Name: "worker", FabricIP: u.Hostname()}
	ws := models.Workspace{ID: wsID, NodeID: nodeID}
	finder := &dummyFinder{node: node, ws: ws}

	// Local Incus fallback would fail with a confusing daemon error; MemoryRuntime is fine to prove we don't call it.
	calledLocal := false
	local := &hookRuntime{
		Runtime: NewMemoryRuntime(),
		onStart: func() { calledLocal = true },
	}
	rt := NewRemoteAgentRuntime(finder, "secret", local)
	rt.Port = port

	err = rt.Start(context.Background(), wsID)
	if err == nil {
		t.Fatal("expected agent error")
	}
	if calledLocal {
		t.Fatal("must not fall back to local runtime after agent HTTP error")
	}
	if !strings.Contains(err.Error(), "already running") && !strings.Contains(err.Error(), "500") {
		t.Fatalf("expected agent error surfaced, got %v", err)
	}
}

func TestRemoteStartIdempotentWhenAgentTreatsAlreadyRunningAsOK(t *testing.T) {
	wsID := uuid.New()
	nodeID := uuid.New()
	started := 0

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/workspaces/start" {
			http.NotFound(w, r)
			return
		}
		started++
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "started"})
	})
	ts := httptest.NewServer(handler)
	t.Cleanup(ts.Close)
	u, _ := url.Parse(ts.URL)
	port, _ := strconv.Atoi(u.Port())

	finder := &dummyFinder{
		node: models.Node{ID: nodeID, Name: "worker", FabricIP: u.Hostname()},
		ws:   models.Workspace{ID: wsID, NodeID: nodeID},
	}
	rt := NewRemoteAgentRuntime(finder, "secret", NewMemoryRuntime())
	rt.Port = port

	if err := rt.Start(context.Background(), wsID); err != nil {
		t.Fatal(err)
	}
	if err := rt.Start(context.Background(), wsID); err != nil {
		t.Fatal(err)
	}
	if started != 2 {
		t.Fatalf("expected 2 agent starts, got %d", started)
	}
}

type hookRuntime struct {
	Runtime
	onStart func()
}

func (h *hookRuntime) Start(ctx context.Context, id uuid.UUID) error {
	if h.onStart != nil {
		h.onStart()
	}
	return h.Runtime.Start(ctx, id)
}
