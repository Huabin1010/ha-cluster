package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/service"
	"ha-cluster/internal/store/memory"
	"ha-cluster/internal/workspace"
)

func testServer(t *testing.T) http.Handler {
	t.Helper()
	st := memory.New()
	app := service.New(st, workspace.NewMemoryRuntime(), []byte("unit-test-secret-key-32b!!"))
	const Gi = 1024 * 1024 * 1024
	_ = st.UpsertNode(t.Context(), &models.Node{
		ID: uuid.New(), Name: "pc1", Arch: models.ArchAMD64, Role: "worker", Power: "mains",
		AllocatableCPU: 8000, AllocatableMem: 2 * Gi, AllocatableDisk: 200 * Gi,
		Ready: true, FabricIP: "10.88.0.10",
	})
	return New(app)
}

func doJSON(t *testing.T, h http.Handler, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf []byte
	if body != nil {
		buf, _ = json.Marshal(body)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(buf))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

func registerLogin(t *testing.T, h http.Handler, user, email string) string {
	t.Helper()
	rr := doJSON(t, h, http.MethodPost, "/auth/register", "", map[string]string{
		"username": user, "email": email, "password": "password1",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("register %d %s", rr.Code, rr.Body.String())
	}
	rr = doJSON(t, h, http.MethodPost, "/auth/login", "", map[string]string{
		"username": user, "password": "password1",
	})
	if rr.Code != http.StatusOK {
		t.Fatalf("login %d %s", rr.Code, rr.Body.String())
	}
	var out struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &out)
	if out.Token == "" {
		t.Fatal("empty token")
	}
	return out.Token
}

func TestHealthz(t *testing.T) {
	h := testServer(t)
	rr := doJSON(t, h, http.MethodGet, "/healthz", "", nil)
	if rr.Code != 200 {
		t.Fatal(rr.Code)
	}
}

func TestAuthRequired(t *testing.T) {
	h := testServer(t)
	rr := doJSON(t, h, http.MethodGet, "/me", "", nil)
	if rr.Code != http.StatusUnauthorized {
		t.Fatal(rr.Code)
	}
}

func TestWorkspaceQuotaHTTP(t *testing.T) {
	h := testServer(t)
	tok := registerLogin(t, h, "alice", "a@x.com")
	rr := doJSON(t, h, http.MethodPost, "/projects", tok, map[string]string{"name": "demo", "slug": "demo"})
	if rr.Code != http.StatusCreated {
		t.Fatal(rr.Body.String())
	}
	var p models.Project
	_ = json.Unmarshal(rr.Body.Bytes(), &p)
	rr = doJSON(t, h, http.MethodPost, "/projects/"+p.ID.String()+"/workspaces", tok, map[string]string{
		"name": "a", "plan": "large", "arch": "amd64",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
	rr = doJSON(t, h, http.MethodPost, "/projects/"+p.ID.String()+"/workspaces", tok, map[string]string{
		"name": "b", "plan": "large", "arch": "amd64",
	})
	if rr.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d %s", rr.Code, rr.Body.String())
	}
	var errBody map[string]string
	_ = json.Unmarshal(rr.Body.Bytes(), &errBody)
	if errBody["error"] != "INSUFFICIENT_CAPACITY" {
		t.Fatalf("%v", errBody)
	}
}

func TestHeartbeatAndCapacity(t *testing.T) {
	h := testServer(t)
	rr := doJSON(t, h, http.MethodPost, "/nodes/heartbeat", "", map[string]any{
		"name": "phone1", "arch": "arm64", "role": "worker", "power": "battery",
		"allocatable_cpu_milli": 2000, "allocatable_mem_bytes": 1 << 30, "allocatable_disk_bytes": 20 << 30,
		"fabric_ip": "10.88.0.11",
	})
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	tok := registerLogin(t, h, "ops", "ops@x.com")
	rr = doJSON(t, h, http.MethodGet, "/capacity", tok, nil)
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
}

func TestLoginRefreshInvite(t *testing.T) {
	h := testServer(t)
	tok := registerLogin(t, h, "alice2", "a2@x.com")
	rr := doJSON(t, h, http.MethodPost, "/auth/login", "", map[string]string{"username": "alice2", "password": "password1"})
	var login struct {
		Token        string `json:"token"`
		RefreshToken string `json:"refresh_token"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &login)
	if login.RefreshToken == "" {
		t.Fatal("missing refresh")
	}
	rr = doJSON(t, h, http.MethodPost, "/auth/refresh", "", map[string]string{"refresh_token": login.RefreshToken})
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	rr = doJSON(t, h, http.MethodPost, "/projects", tok, map[string]string{"name": "p", "slug": "px"})
	var p models.Project
	_ = json.Unmarshal(rr.Body.Bytes(), &p)
	rr = doJSON(t, h, http.MethodPost, "/projects/"+p.ID.String()+"/invitations", tok, map[string]string{"email": "x@y.com", "role": "developer"})
	if rr.Code != 201 {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
}

func TestMembersInviteAcceptAndRBAC(t *testing.T) {
	h := testServer(t)
	ownerTok := registerLogin(t, h, "own3", "own3@x.com")
	rr := doJSON(t, h, http.MethodPost, "/projects", ownerTok, map[string]string{"name": "m", "slug": "m-u3"})
	if rr.Code != http.StatusCreated {
		t.Fatal(rr.Body.String())
	}
	var p models.Project
	_ = json.Unmarshal(rr.Body.Bytes(), &p)

	_ = registerLogin(t, h, "dev3", "dev3@x.com")
	rr = doJSON(t, h, http.MethodPost, "/projects/"+p.ID.String()+"/members", ownerTok, map[string]string{
		"username": "dev3", "role": "developer",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("add member %d %s", rr.Code, rr.Body.String())
	}

	viewerTok := registerLogin(t, h, "view3", "view3@x.com")
	rr = doJSON(t, h, http.MethodPost, "/projects/"+p.ID.String()+"/members", ownerTok, map[string]string{
		"username": "view3", "role": "viewer",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("add viewer %d %s", rr.Code, rr.Body.String())
	}

	rr = doJSON(t, h, http.MethodGet, "/projects/"+p.ID.String()+"/members", ownerTok, nil)
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	var list struct {
		Data []models.Membership `json:"data"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &list)
	var devID string
	for _, m := range list.Data {
		if m.Role == models.RoleDeveloper {
			devID = m.UserID.String()
			break
		}
	}
	if devID == "" {
		t.Fatal("developer missing from membership list")
	}

	// viewer cannot remove members (U3 验收 #4)
	rr = doJSON(t, h, http.MethodDelete, "/projects/"+p.ID.String()+"/members/"+devID, viewerTok, nil)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("viewer remove want 403 got %d %s", rr.Code, rr.Body.String())
	}

	// Add an admin member
	adminTok := registerLogin(t, h, "adm3", "adm3@x.com")
	rr = doJSON(t, h, http.MethodPost, "/projects/"+p.ID.String()+"/members", ownerTok, map[string]string{
		"username": "adm3", "role": "admin",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("add admin want 201 got %d %s", rr.Code, rr.Body.String())
	}

	// Admin cannot grant owner role
	_ = registerLogin(t, h, "user-target", "target@x.com")
	rr = doJSON(t, h, http.MethodPost, "/projects/"+p.ID.String()+"/members", adminTok, map[string]string{
		"username": "user-target", "role": "owner",
	})
	if rr.Code != http.StatusForbidden {
		t.Fatalf("admin granting owner want 403 got %d %s", rr.Code, rr.Body.String())
	}

	// Admin cannot remove the owner
	rr = doJSON(t, h, http.MethodDelete, "/projects/"+p.ID.String()+"/members/"+p.OwnerID.String(), adminTok, nil)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("admin removing owner want 403 got %d %s", rr.Code, rr.Body.String())
	}

	rr = doJSON(t, h, http.MethodPost, "/projects/"+p.ID.String()+"/invitations", ownerTok, map[string]string{
		"email": "bob3@x.com", "role": "developer",
	})
	if rr.Code != http.StatusCreated {
		t.Fatal(rr.Body.String())
	}
	var inv models.Invitation
	_ = json.Unmarshal(rr.Body.Bytes(), &inv)
	if inv.Token == "" {
		t.Fatal("missing invite token")
	}

	bobTok := registerLogin(t, h, "bob3", "bob3@x.com")
	rr = doJSON(t, h, http.MethodPost, "/invitations/accept", bobTok, map[string]string{"token": inv.Token})
	if rr.Code != http.StatusOK {
		t.Fatalf("accept %d %s", rr.Code, rr.Body.String())
	}
	var accepted struct {
		Status    string `json:"status"`
		ProjectID string `json:"project_id"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &accepted)
	if accepted.Status != "accepted" || accepted.ProjectID != p.ID.String() {
		t.Fatalf("accept body %+v", accepted)
	}

	rr = doJSON(t, h, http.MethodGet, "/projects", bobTok, nil)
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), p.ID.String()) {
		t.Fatal("bob should see invited project")
	}
}

func TestInternalSSHTarget(t *testing.T) {
	t.Setenv("HA_INTERNAL_TOKEN", "test-internal")
	h := testServer(t)
	tok := registerLogin(t, h, "dev1", "dev1@x.com")
	rr := doJSON(t, h, http.MethodPost, "/projects", tok, map[string]string{"name": "p", "slug": "p-ssh"})
	if rr.Code != http.StatusCreated {
		t.Fatal(rr.Body.String())
	}
	var p models.Project
	_ = json.Unmarshal(rr.Body.Bytes(), &p)
	rr = doJSON(t, h, http.MethodPost, "/projects/"+p.ID.String()+"/workspaces", tok, map[string]string{
		"name": "w", "plan": "nano", "arch": "amd64",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
	var ws models.Workspace
	_ = json.Unmarshal(rr.Body.Bytes(), &ws)

	req := httptest.NewRequest(http.MethodGet, "/internal/ssh-target?user=dev1&id="+ws.ID.String(), nil)
	req.Header.Set("X-HA-Internal", "test-internal")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/internal/ssh-target?user=dev1&id="+ws.ID.String(), nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 got %d", rec.Code)
	}

	cfg := doJSON(t, h, http.MethodGet, "/workspaces/"+ws.ID.String()+"/ssh-config", tok, nil)
	if cfg.Code != 200 {
		t.Fatal(cfg.Body.String())
	}
	if !strings.Contains(cfg.Body.String(), "Port 8099") {
		t.Fatalf("ssh-config missing Port 8099: %s", cfg.Body.String())
	}
	if !strings.Contains(cfg.Body.String(), "bastion.mnnumath.vip") {
		t.Fatal(cfg.Body.String())
	}
}

func TestProjectCreateUsageAndBudget(t *testing.T) {
	h := testServer(t)
	tok := registerLogin(t, h, "projowner", "projowner@example.com")

	bad := doJSON(t, h, http.MethodPost, "/projects", tok, map[string]string{"name": "x", "slug": "Bad_Slug"})
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("invalid slug want 400 got %d %s", bad.Code, bad.Body.String())
	}

	rr := doJSON(t, h, http.MethodPost, "/projects", tok, map[string]string{"name": "Demo", "slug": "demo-u2"})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create %d %s", rr.Code, rr.Body.String())
	}
	var p models.Project
	if err := json.Unmarshal(rr.Body.Bytes(), &p); err != nil || p.ID == uuid.Nil {
		t.Fatal(err, p)
	}

	dup := doJSON(t, h, http.MethodPost, "/projects", tok, map[string]string{"name": "Demo2", "slug": "demo-u2"})
	if dup.Code != http.StatusConflict {
		t.Fatalf("dup slug want 409 got %d %s", dup.Code, dup.Body.String())
	}

	usage := doJSON(t, h, http.MethodGet, "/projects/"+p.ID.String()+"/usage", tok, nil)
	if usage.Code != 200 {
		t.Fatal(usage.Body.String())
	}
	var u map[string]any
	_ = json.Unmarshal(usage.Body.Bytes(), &u)
	if _, ok := u["workspaces"]; !ok {
		t.Fatalf("usage missing workspaces: %v", u)
	}

	neg := doJSON(t, h, http.MethodPatch, "/projects/"+p.ID.String(), tok, map[string]any{
		"budget_mem_bytes": -1,
	})
	if neg.Code != http.StatusBadRequest {
		t.Fatalf("neg budget want 400 got %d %s", neg.Code, neg.Body.String())
	}

	patch := doJSON(t, h, http.MethodPatch, "/projects/"+p.ID.String(), tok, map[string]any{
		"budget_cpu_milli":  500,
		"budget_mem_bytes":  1 << 20,
		"budget_disk_bytes": 0,
	})
	if patch.Code != 200 {
		t.Fatal(patch.Body.String())
	}
	var got models.Project
	_ = json.Unmarshal(patch.Body.Bytes(), &got)
	if got.BudgetCPUMilli != 500 || got.BudgetMemBytes != 1<<20 {
		t.Fatalf("budget not saved: %+v", got)
	}

	one := doJSON(t, h, http.MethodGet, "/projects/"+p.ID.String(), tok, nil)
	if one.Code != 200 {
		t.Fatal(one.Body.String())
	}
}

func TestHeartbeatAuth(t *testing.T) {
	h := testServer(t)
	t.Setenv("HA_NODE_TOKEN", "secret-cluster-node-token-123")

	nodePayload := map[string]any{
		"name": "worker-secured", "arch": "amd64", "role": "worker",
		"allocatable_cpu_milli": 4000, "allocatable_mem_bytes": 8000,
	}

	// 1. Without token -> 401 Unauthorized
	reqWithoutTok := doJSON(t, h, http.MethodPost, "/nodes/heartbeat", "", nodePayload)
	if reqWithoutTok.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 unauthorized without token, got %d %s", reqWithoutTok.Code, reqWithoutTok.Body.String())
	}

	// 2. With wrong token -> 401 Unauthorized
	buf, _ := json.Marshal(nodePayload)
	wrongReq := httptest.NewRequest(http.MethodPost, "/nodes/heartbeat", bytes.NewReader(buf))
	wrongReq.Header.Set("Content-Type", "application/json")
	wrongReq.Header.Set("X-HA-Node-Token", "wrong-token")
	wrongRR := httptest.NewRecorder()
	h.ServeHTTP(wrongRR, wrongReq)
	if wrongRR.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 unauthorized with wrong token, got %d", wrongRR.Code)
	}

	// 3. With correct token in X-HA-Node-Token -> 200 OK
	okReq := httptest.NewRequest(http.MethodPost, "/nodes/heartbeat", bytes.NewReader(buf))
	okReq.Header.Set("Content-Type", "application/json")
	okReq.Header.Set("X-HA-Node-Token", "secret-cluster-node-token-123")
	okRR := httptest.NewRecorder()
	h.ServeHTTP(okRR, okReq)
	if okRR.Code != http.StatusOK {
		t.Fatalf("expected 200 OK with correct token, got %d %s", okRR.Code, okRR.Body.String())
	}
}

