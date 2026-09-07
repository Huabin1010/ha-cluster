package agent

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/workspace"
)

func TestAgentServerRoutes(t *testing.T) {
	memRt := workspace.NewMemoryRuntime()
	token := "test-secret-token"
	srv := NewServer(memRt, token, ":9091")
	h := srv.Routes()

	// 1. Healthz check without token
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("healthz: expected 200, got %d", rr.Code)
	}

	wsID := uuid.New()
	nodeID := uuid.New()
	ws := models.Workspace{ID: wsID, Plan: "nano", CPUMilli: 500, MemBytes: 256 * 1024 * 1024, DiskBytes: 5 * 1024 * 1024 * 1024}
	node := models.Node{ID: nodeID, Name: "worker-1", FabricIP: "10.88.0.2"}

	// 2. Launch without token -> 401
	launchReq := LaunchRequest{Workspace: ws, Node: node, SSHKeys: []string{"ssh-ed25519 AAA..."}}
	b, _ := json.Marshal(launchReq)
	req = httptest.NewRequest(http.MethodPost, "/v1/workspaces/launch", bytes.NewReader(b))
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}

	// 3. Launch with valid token -> 200
	req = httptest.NewRequest(http.MethodPost, "/v1/workspaces/launch", bytes.NewReader(b))
	req.Header.Set("X-HA-Node-Token", token)
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var inst workspace.Instance
	if err := json.NewDecoder(rr.Body).Decode(&inst); err != nil {
		t.Fatalf("decode instance: %v", err)
	}
	if inst.ID != wsID || !inst.Running {
		t.Fatalf("unexpected instance: %+v", inst)
	}

	// 4. Stop workspace
	idPayload, _ := json.Marshal(IDRequest{WorkspaceID: wsID})
	req = httptest.NewRequest(http.MethodPost, "/v1/workspaces/stop", bytes.NewReader(idPayload))
	req.Header.Set("Authorization", "Bearer "+token)
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("stop expected 200, got %d", rr.Code)
	}

	// 5. Start workspace
	req = httptest.NewRequest(http.MethodPost, "/v1/workspaces/start", bytes.NewReader(idPayload))
	req.Header.Set("X-HA-Node-Token", token)
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("start expected 200, got %d", rr.Code)
	}

	// 6. Resize workspace
	resizePayload, _ := json.Marshal(ResizeRequest{Workspace: ws})
	req = httptest.NewRequest(http.MethodPost, "/v1/workspaces/resize", bytes.NewReader(resizePayload))
	req.Header.Set("X-HA-Node-Token", token)
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("resize expected 200, got %d", rr.Code)
	}

	// 7. Get workspace
	req = httptest.NewRequest(http.MethodPost, "/v1/workspaces/get", bytes.NewReader(idPayload))
	req.Header.Set("X-HA-Node-Token", token)
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("get expected 200, got %d", rr.Code)
	}

	// 8. Expose port
	routeID := uuid.New()
	exposePayload, _ := json.Marshal(ExposePortRequest{
		WorkspaceID:   wsID,
		RouteID:       routeID,
		ContainerPort: 8080,
	})
	req = httptest.NewRequest(http.MethodPost, "/v1/workspaces/expose-port", bytes.NewReader(exposePayload))
	req.Header.Set("X-HA-Node-Token", token)
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expose-port expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var exposeResp map[string]int
	if err := json.NewDecoder(rr.Body).Decode(&exposeResp); err != nil || exposeResp["host_port"] <= 0 {
		t.Fatalf("invalid expose-port response: %v, body: %s", err, rr.Body.String())
	}

	// 9. Unexpose port
	unexposePayload, _ := json.Marshal(UnexposePortRequest{
		WorkspaceID: wsID,
		RouteID:     routeID,
	})
	req = httptest.NewRequest(http.MethodPost, "/v1/workspaces/unexpose-port", bytes.NewReader(unexposePayload))
	req.Header.Set("X-HA-Node-Token", token)
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("unexpose-port expected 200, got %d", rr.Code)
	}

	// 10. Sync keys
	syncPayload, _ := json.Marshal(SyncKeysRequest{
		WorkspaceID: wsID,
		SSHKeys:     []string{"ssh-ed25519 testkey1", "ssh-ed25519 testkey2"},
	})
	req = httptest.NewRequest(http.MethodPost, "/v1/workspaces/sync-keys", bytes.NewReader(syncPayload))
	req.Header.Set("X-HA-Node-Token", token)
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("sync-keys expected 200, got %d", rr.Code)
	}

	// 11. Destroy workspace
	req = httptest.NewRequest(http.MethodPost, "/v1/workspaces/destroy", bytes.NewReader(idPayload))
	req.Header.Set("X-HA-Node-Token", token)
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("destroy expected 200, got %d", rr.Code)
	}
}
