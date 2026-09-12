package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/service"
	"ha-cluster/internal/store/memory"
	"ha-cluster/internal/workspace"
)

func testServer(t *testing.T) http.Handler {
	t.Helper()
	t.Setenv("HA_BASTION_HOST", "bastion.mnnumath.vip")
	t.Setenv("HA_BASTION_PORT", "8099")
	t.Setenv("HA_BASTION_DIRECT", "0")
	t.Setenv("HA_AGENT_VIA_LAN", "0")
	t.Setenv("HA_PROVISION_SYNC", "1")
	st := memory.New()
	app := service.New(st, workspace.NewMemoryRuntime(), []byte("unit-test-secret-key-32b!!"))
	const Gi = 1024 * 1024 * 1024
	_ = st.UpsertNode(t.Context(), &models.Node{
		ID: uuid.New(), Name: "pc1", Arch: models.ArchAMD64, Role: "worker", Power: "mains",
		AllocatableCPU: 8000, AllocatableMem: 2 * Gi, AllocatableDisk: 200 * Gi,
		Ready: true, FabricIP: "10.88.0.10", LanIP: "192.168.1.82",
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

func TestAuditActorUsernameAndIP(t *testing.T) {
	h := testServer(t)
	tok := registerLogin(t, h, "auditadmin", "auditadmin@x.com")
	rr := doJSON(t, h, http.MethodGet, "/audit-logs", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
	var out struct {
		Data []models.AuditLog `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	var login *models.AuditLog
	for i := range out.Data {
		if out.Data[i].Action == "user.login" {
			login = &out.Data[i]
			break
		}
	}
	if login == nil {
		t.Fatalf("no user.login in %#v", out.Data)
	}
	if login.ActorUsername != "auditadmin" {
		t.Fatalf("actor_username=%q", login.ActorUsername)
	}
	if login.IP != "192.0.2.1" {
		t.Fatalf("ip=%q", login.IP)
	}
}

func TestWorkspaceAuditHTTP(t *testing.T) {
	h := testServer(t)
	tok := registerLogin(t, h, "wsaudit", "wsaudit@x.com")
	rr := doJSON(t, h, http.MethodPost, "/projects", tok, map[string]string{"name": "wa", "slug": "wa"})
	if rr.Code != http.StatusCreated {
		t.Fatal(rr.Body.String())
	}
	var p models.Project
	_ = json.Unmarshal(rr.Body.Bytes(), &p)
	rr = doJSON(t, h, http.MethodPost, "/projects/"+p.ID.String()+"/workspaces", tok, map[string]string{
		"name": "wa-ws", "plan": "nano", "arch": "amd64",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
	var ws models.Workspace
	_ = json.Unmarshal(rr.Body.Bytes(), &ws)

	rr = doJSON(t, h, http.MethodGet, "/workspaces/"+ws.ID.String()+"/audit", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("%d %s", rr.Code, rr.Body.String())
	}
	var out struct {
		Data []models.AuditLog `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, l := range out.Data {
		if l.Action == "workspace.create" || l.Action == "workspace.request" {
			found = true
			if l.ActorUsername != "wsaudit" {
				t.Fatalf("actor_username=%q", l.ActorUsername)
			}
			break
		}
	}
	if !found {
		t.Fatalf("no workspace create/request in %#v", out.Data)
	}

	stranger := registerLogin(t, h, "stranger", "stranger@x.com")
	rr = doJSON(t, h, http.MethodGet, "/workspaces/"+ws.ID.String()+"/audit", stranger, nil)
	if rr.Code != http.StatusForbidden && rr.Code != http.StatusNotFound {
		t.Fatalf("want 403/404 got %d %s", rr.Code, rr.Body.String())
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

func TestHeartbeatStoresHostTotals(t *testing.T) {
	h := testServer(t)
	const Gi = int64(1 << 30)
	rr := doJSON(t, h, http.MethodPost, "/nodes/heartbeat", "", map[string]any{
		"name": "jammy", "arch": "amd64", "role": "worker",
		"allocatable_cpu_milli": 4000, "allocatable_mem_bytes": 4 * Gi, "allocatable_disk_bytes": 32 * Gi,
		"mem_total_bytes": 4 * Gi, "disk_total_bytes": 40 * Gi,
		"mem_available_bytes": 3 * Gi, "disk_free_bytes": 30 * Gi,
		"fabric_ip": "10.129.129.205",
	})
	if rr.Code != 200 {
		t.Fatal(rr.Body.String())
	}
	var n models.Node
	if err := json.Unmarshal(rr.Body.Bytes(), &n); err != nil {
		t.Fatal(err)
	}
	if n.MemTotalBytes != 4*Gi || n.DiskTotalBytes != 40*Gi {
		t.Fatalf("host totals mem=%d disk=%d", n.MemTotalBytes, n.DiskTotalBytes)
	}
	if n.MemAvailableBytes != 3*Gi || n.DiskFreeBytes != 30*Gi {
		t.Fatalf("host free mem=%d disk=%d", n.MemAvailableBytes, n.DiskFreeBytes)
	}
	if n.UsedMem != 0 {
		t.Fatalf("ledger used mem should stay 0, got %d", n.UsedMem)
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
	var targetResp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &targetResp); err != nil {
		t.Fatalf("unmarshal target response: %v", err)
	}
	for _, field := range []string{"visibility", "owner_user_id", "actor_user_id", "membership_role", "is_admin"} {
		if _, ok := targetResp[field]; !ok {
			t.Fatalf("missing expected field %q in ssh-target response", field)
		}
	}

	// Create another developer in the same project and a private workspace
	_ = registerLogin(t, h, "dev2", "dev2@x.com")
	_ = doJSON(t, h, http.MethodPost, "/projects/"+p.ID.String()+"/members", tok, map[string]string{
		"username": "dev2", "role": "developer",
	})
	rrPriv := doJSON(t, h, http.MethodPost, "/projects/"+p.ID.String()+"/workspaces", tok, map[string]string{
		"name": "priv-ws", "plan": "nano", "arch": "amd64", "visibility": "private",
	})
	if rrPriv.Code != http.StatusCreated {
		t.Fatalf("create priv ws failed: %d %s", rrPriv.Code, rrPriv.Body.String())
	}
	var privWs models.Workspace
	_ = json.Unmarshal(rrPriv.Body.Bytes(), &privWs)

	// dev2 trying to access dev1's private workspace via internal ssh-target must get 403
	reqPrivDenied := httptest.NewRequest(http.MethodGet, "/internal/ssh-target?user=dev2&id="+privWs.ID.String(), nil)
	reqPrivDenied.Header.Set("X-HA-Internal", "test-internal")
	recPrivDenied := httptest.NewRecorder()
	h.ServeHTTP(recPrivDenied, reqPrivDenied)
	if recPrivDenied.Code != http.StatusForbidden {
		t.Fatalf("expected 403 forbidden for other dev on private ws, got %d %s", recPrivDenied.Code, recPrivDenied.Body.String())
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

func TestWorkspaceApprovalHTTP(t *testing.T) {
	h := testServer(t)
	ownerTok := registerLogin(t, h, "own", "own@x.com")
	devTok := registerLogin(t, h, "devapp", "devapp@x.com")
	rr := doJSON(t, h, http.MethodPost, "/projects", ownerTok, map[string]string{"name": "ap", "slug": "ap"})
	if rr.Code != http.StatusCreated {
		t.Fatal(rr.Body.String())
	}
	var p models.Project
	_ = json.Unmarshal(rr.Body.Bytes(), &p)
	rr = doJSON(t, h, http.MethodPost, "/projects/"+p.ID.String()+"/members", ownerTok, map[string]string{
		"username": "devapp", "role": "developer", "ssh_access": "granted",
	})
	if rr.Code != http.StatusCreated {
		t.Fatal(rr.Body.String())
	}
	rr = doJSON(t, h, http.MethodPost, "/projects/"+p.ID.String()+"/workspaces", devTok, map[string]string{
		"name": "wait", "plan": "nano", "arch": "amd64",
	})
	if rr.Code != http.StatusCreated {
		t.Fatal(rr.Body.String())
	}
	var ws models.Workspace
	_ = json.Unmarshal(rr.Body.Bytes(), &ws)
	if ws.Status != models.WSRequested {
		t.Fatalf("want requested got %s", ws.Status)
	}
	conn := doJSON(t, h, http.MethodGet, "/workspaces/"+ws.ID.String()+"/connection", devTok, nil)
	if conn.Code == http.StatusOK {
		t.Fatalf("no connect before approve: %d %s", conn.Code, conn.Body.String())
	}
	rr = doJSON(t, h, http.MethodPost, "/workspaces/"+ws.ID.String()+"/approve", ownerTok, map[string]string{})
	if rr.Code != http.StatusOK {
		t.Fatal(rr.Body.String())
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &ws)
	if ws.Status != models.WSRunning {
		t.Fatalf("%s", ws.Status)
	}
	conn = doJSON(t, h, http.MethodGet, "/workspaces/"+ws.ID.String()+"/connection", devTok, nil)
	if conn.Code != http.StatusOK {
		t.Fatal(conn.Body.String())
	}
	if !strings.Contains(conn.Body.String(), "bastion.mnnumath.vip") {
		t.Fatal(conn.Body.String())
	}
}

func TestSSHConnectionDirectMode(t *testing.T) {
	h := testServer(t)
	t.Setenv("HA_BASTION_DIRECT", "1")
	t.Setenv("HA_AGENT_VIA_LAN", "0")
	tok := registerLogin(t, h, "lab", "lab@x.com")
	rr := doJSON(t, h, http.MethodPost, "/projects", tok, map[string]string{"name": "lab", "slug": "lab-direct"})
	if rr.Code != http.StatusCreated {
		t.Fatal(rr.Body.String())
	}
	var p models.Project
	_ = json.Unmarshal(rr.Body.Bytes(), &p)
	rr = doJSON(t, h, http.MethodPost, "/projects/"+p.ID.String()+"/workspaces", tok, map[string]string{
		"name": "ws1", "plan": "nano", "arch": "amd64",
	})
	if rr.Code != http.StatusCreated {
		t.Fatal(rr.Body.String())
	}
	var ws models.Workspace
	_ = json.Unmarshal(rr.Body.Bytes(), &ws)
	conn := doJSON(t, h, http.MethodGet, "/workspaces/"+ws.ID.String()+"/connection", tok, nil)
	if conn.Code != http.StatusOK {
		t.Fatal(conn.Body.String())
	}
	body := conn.Body.String()
	if !strings.Contains(body, `"mode":"direct"`) {
		t.Fatalf("want direct mode: %s", body)
	}
	if !strings.Contains(body, "10.88.0.10") {
		t.Fatalf("want fabric ip in direct cmd: %s", body)
	}
	if strings.Contains(body, "bastion.mnnumath.vip") {
		t.Fatalf("bastion host must not appear in direct mode: %s", body)
	}
}

func TestSSHConnectionDirectLanMode(t *testing.T) {
	h := testServer(t)
	t.Setenv("HA_BASTION_DIRECT", "1")
	t.Setenv("HA_AGENT_VIA_LAN", "1")
	tok := registerLogin(t, h, "lab2", "lab2@x.com")
	rr := doJSON(t, h, http.MethodPost, "/projects", tok, map[string]string{"name": "lab-lan", "slug": "lab-direct-lan"})
	if rr.Code != http.StatusCreated {
		t.Fatal(rr.Body.String())
	}
	var p models.Project
	_ = json.Unmarshal(rr.Body.Bytes(), &p)
	rr = doJSON(t, h, http.MethodPost, "/projects/"+p.ID.String()+"/workspaces", tok, map[string]string{
		"name": "ws1", "plan": "nano", "arch": "amd64",
	})
	if rr.Code != http.StatusCreated {
		t.Fatal(rr.Body.String())
	}
	var ws models.Workspace
	_ = json.Unmarshal(rr.Body.Bytes(), &ws)
	conn := doJSON(t, h, http.MethodGet, "/workspaces/"+ws.ID.String()+"/connection", tok, nil)
	if conn.Code != http.StatusOK {
		t.Fatal(conn.Body.String())
	}
	body := conn.Body.String()
	if !strings.Contains(body, `"via":"lan"`) {
		t.Fatalf("want lan via: %s", body)
	}
	if !strings.Contains(body, "192.168.1.82") {
		t.Fatalf("want lan ip in direct cmd: %s", body)
	}
	if strings.Contains(body, "10.88.0.10") {
		t.Fatalf("fabric ip must not appear when HA_AGENT_VIA_LAN=1: %s", body)
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

	rename := doJSON(t, h, http.MethodPatch, "/projects/"+p.ID.String(), tok, map[string]any{
		"name": "Renamed", "slug": "demo-renamed",
	})
	if rename.Code != 200 {
		t.Fatal(rename.Body.String())
	}
	var renamed models.Project
	_ = json.Unmarshal(rename.Body.Bytes(), &renamed)
	if renamed.Name != "Renamed" || renamed.Slug != "demo-renamed" {
		t.Fatalf("rename not saved: %+v", renamed)
	}

	del := doJSON(t, h, http.MethodDelete, "/projects/"+p.ID.String(), tok, nil)
	if del.Code != http.StatusNoContent {
		t.Fatalf("delete want 204 got %d %s", del.Code, del.Body.String())
	}
	gone := doJSON(t, h, http.MethodGet, "/projects/"+p.ID.String(), tok, nil)
	if gone.Code != http.StatusNotFound && gone.Code != http.StatusForbidden {
		t.Fatalf("deleted project want 404/403 got %d %s", gone.Code, gone.Body.String())
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

func TestApiPrefixAndSPAFallback(t *testing.T) {
	// 创建临时测试前端目录
	tmpDir := t.TempDir()
	indexPath := tmpDir + "/index.html"
	assetsDir := tmpDir + "/assets"
	_ = os.MkdirAll(assetsDir, 0755)
	_ = os.WriteFile(indexPath, []byte("<html><body>HA Web App</body></html>"), 0644)
	_ = os.WriteFile(assetsDir+"/test.js", []byte("console.log('ha-web');"), 0644)

	t.Setenv("HA_WEB_DIR", tmpDir)

	st := memory.New()
	app := service.New(st, workspace.NewMemoryRuntime(), []byte("unit-test-secret-key-32b!!"))
	h := New(app)

	// 1. 测试 /api 前缀路由工作正常
	reqAPI := httptest.NewRequest(http.MethodGet, "/api/healthz", nil)
	recAPI := httptest.NewRecorder()
	h.ServeHTTP(recAPI, reqAPI)
	if recAPI.Code != http.StatusOK {
		t.Fatalf("expected 200 for /api/healthz, got %d", recAPI.Code)
	}

	// 2. 测试根路径 API 依然工作正常
	reqRoot := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	recRoot := httptest.NewRecorder()
	h.ServeHTTP(recRoot, reqRoot)
	if recRoot.Code != http.StatusOK {
		t.Fatalf("expected 200 for /healthz, got %d", recRoot.Code)
	}

	// 3. 测试静态资源正确命中
	reqAsset := httptest.NewRequest(http.MethodGet, "/assets/test.js", nil)
	recAsset := httptest.NewRecorder()
	h.ServeHTTP(recAsset, reqAsset)
	if recAsset.Code != http.StatusOK || !strings.Contains(recAsset.Body.String(), "ha-web") {
		t.Fatalf("expected 200 and static content for /assets/test.js, got %d %s", recAsset.Code, recAsset.Body.String())
	}

	// 3b. Accept: text/html 也不能把已有 JS 变成 HTML
	reqAssetHTML := httptest.NewRequest(http.MethodGet, "/assets/test.js", nil)
	reqAssetHTML.Header.Set("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
	recAssetHTML := httptest.NewRecorder()
	h.ServeHTTP(recAssetHTML, reqAssetHTML)
	if recAssetHTML.Code != http.StatusOK || !strings.Contains(recAssetHTML.Body.String(), "ha-web") {
		t.Fatalf("expected JS for /assets/test.js even with Accept HTML, got %d %s", recAssetHTML.Code, recAssetHTML.Body.String())
	}

	// 3c. 缺失的指纹分包必须 404，禁止回退 index.html（否则 MIME 变成 text/html）
	reqMissing := httptest.NewRequest(http.MethodGet, "/assets/Members-missing.js", nil)
	reqMissing.Header.Set("Accept", "text/html,application/javascript,*/*")
	recMissing := httptest.NewRecorder()
	h.ServeHTTP(recMissing, reqMissing)
	if recMissing.Code != http.StatusNotFound || strings.Contains(recMissing.Body.String(), "HA Web App") {
		t.Fatalf("expected 404 for missing asset, got %d %s", recMissing.Code, recMissing.Body.String())
	}

	// 4. 测试 SPA 路由回退至 index.html
	reqSPA := httptest.NewRequest(http.MethodGet, "/projects/123/workspaces", nil)
	reqSPA.Header.Set("Accept", "text/html")
	recSPA := httptest.NewRecorder()
	h.ServeHTTP(recSPA, reqSPA)
	if recSPA.Code != http.StatusOK || !strings.Contains(recSPA.Body.String(), "HA Web App") {
		t.Fatalf("expected 200 and index.html for SPA route, got %d %s", recSPA.Code, recSPA.Body.String())
	}
	if cc := recSPA.Header().Get("Cache-Control"); !strings.Contains(cc, "no-cache") {
		t.Fatalf("expected no-cache on SPA index.html, got %q", cc)
	}

	reqMembers := httptest.NewRequest(http.MethodGet, "/members", nil)
	reqMembers.Header.Set("Accept", "text/html")
	recMembers := httptest.NewRecorder()
	h.ServeHTTP(recMembers, reqMembers)
	if recMembers.Code != http.StatusOK || !strings.Contains(recMembers.Body.String(), "HA Web App") {
		t.Fatalf("expected 200 and index.html for /members, got %d %s", recMembers.Code, recMembers.Body.String())
	}

	// 5. 测试未知 API 路由依然返回 404 JSON 而不是 index.html
	req404 := httptest.NewRequest(http.MethodGet, "/api/nonexistent-endpoint", nil)
	rec404 := httptest.NewRecorder()
	h.ServeHTTP(rec404, req404)
	if rec404.Code != http.StatusNotFound || strings.Contains(rec404.Body.String(), "<html>") {
		t.Fatalf("expected 404 JSON for unknown API, got %d %s", rec404.Code, rec404.Body.String())
	}
}

func TestIngressApprovalAPI(t *testing.T) {
	h := testServer(t)
	ownerTok := registerLogin(t, h, "ingowner", "ingowner@x.com")
	devTok := registerLogin(t, h, "ingdev", "ingdev@x.com")

	rr := doJSON(t, h, http.MethodPost, "/projects", ownerTok, map[string]string{"name": "ingproj", "slug": "ingproj"})
	if rr.Code != http.StatusCreated {
		t.Fatal(rr.Body.String())
	}
	var p models.Project
	_ = json.Unmarshal(rr.Body.Bytes(), &p)

	rr = doJSON(t, h, http.MethodPost, "/projects/"+p.ID.String()+"/members", ownerTok, map[string]string{
		"username": "ingdev", "role": "developer",
	})
	if rr.Code != http.StatusCreated {
		t.Fatal(rr.Body.String())
	}

	rr = doJSON(t, h, http.MethodPost, "/projects/"+p.ID.String()+"/workspaces", ownerTok, map[string]string{
		"name": "ingws", "plan": "nano", "arch": "amd64",
	})
	if rr.Code != http.StatusCreated {
		t.Fatal(rr.Body.String())
	}
	var ws models.Workspace
	_ = json.Unmarshal(rr.Body.Bytes(), &ws)

	// 1. 保留词申请被阻断
	resBad := doJSON(t, h, http.MethodPost, "/workspaces/"+ws.ID.String()+"/ingress", devTok, map[string]any{
		"domain": "admin.domain.com", "port": 8080,
	})
	if resBad.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for reserved subdomain, got %d %s", resBad.Code, resBad.Body.String())
	}

	// 2. 普通开发者申请合法域名 -> pending_approval
	resApp := doJSON(t, h, http.MethodPost, "/workspaces/"+ws.ID.String()+"/ingress", devTok, map[string]any{
		"domain": "myapp.domain.com", "port": 8080,
	})
	if resApp.Code != http.StatusCreated {
		t.Fatalf("create ingress failed: %d %s", resApp.Code, resApp.Body.String())
	}
	var r1 models.IngressRoute
	_ = json.Unmarshal(resApp.Body.Bytes(), &r1)
	if r1.Status != models.IngressPendingApproval {
		t.Fatalf("expected pending_approval, got %s", r1.Status)
	}

	// 3. 开发者尝试自批 -> 403 Forbidden
	resSelfApprove := doJSON(t, h, http.MethodPost, "/ingress/"+r1.ID.String()+"/approve", devTok, nil)
	if resSelfApprove.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for dev approve, got %d", resSelfApprove.Code)
	}

	// 4. Owner 审批通过 -> 200 OK, active
	resOwnerApprove := doJSON(t, h, http.MethodPost, "/ingress/"+r1.ID.String()+"/approve", ownerTok, nil)
	if resOwnerApprove.Code != http.StatusOK {
		t.Fatalf("expected 200 for owner approve, got %d %s", resOwnerApprove.Code, resOwnerApprove.Body.String())
	}
	var r1Approved models.IngressRoute
	_ = json.Unmarshal(resOwnerApprove.Body.Bytes(), &r1Approved)
	if r1Approved.Status != models.IngressActive {
		t.Fatalf("expected active, got %s", r1Approved.Status)
	}
	if r1Approved.HostPort <= 0 {
		t.Fatalf("expected HostPort > 0 after approval, got %d", r1Approved.HostPort)
	}

	// 5. 开发者申请另一个域名 -> Owner 驳回
	resApp2 := doJSON(t, h, http.MethodPost, "/workspaces/"+ws.ID.String()+"/ingress", devTok, map[string]any{
		"domain": "myapp2.domain.com", "port": 8080,
	})
	if resApp2.Code != http.StatusCreated {
		t.Fatalf("create ingress failed: %d %s", resApp2.Code, resApp2.Body.String())
	}
	var r2 models.IngressRoute
	_ = json.Unmarshal(resApp2.Body.Bytes(), &r2)

	resReject := doJSON(t, h, http.MethodPost, "/ingress/"+r2.ID.String()+"/reject", ownerTok, map[string]string{
		"reason": "命名不规范",
	})
	if resReject.Code != http.StatusOK {
		t.Fatalf("expected 200 for owner reject, got %d %s", resReject.Code, resReject.Body.String())
	}
	var r2Rejected models.IngressRoute
	_ = json.Unmarshal(resReject.Body.Bytes(), &r2Rejected)
	if r2Rejected.Status != models.IngressRejected || r2Rejected.RejectReason != "命名不规范" {
		t.Fatalf("expected rejected with reason, got %+v", r2Rejected)
	}
}

func TestIngressDomainZonesAPI(t *testing.T) {
	h := testServer(t)
	adminTok := registerLogin(t, h, "zoneadmin", "zoneadmin@x.com")
	devTok := registerLogin(t, h, "zonedev", "zonedev@x.com")

	forbidden := doJSON(t, h, http.MethodPost, "/admin/ingress-domains", devTok, map[string]any{
		"suffix": "apps.test", "display_name": "Apps",
	})
	if forbidden.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", forbidden.Code)
	}

	created := doJSON(t, h, http.MethodPost, "/admin/ingress-domains", adminTok, map[string]any{
		"suffix": "apps.test", "display_name": "Apps", "require_approval": false,
		"enabled": true, "allow_random": true, "allow_custom_prefix": true,
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("create zone: %d %s", created.Code, created.Body.String())
	}
	var zone models.IngressDomainZone
	_ = json.Unmarshal(created.Body.Bytes(), &zone)

	need := doJSON(t, h, http.MethodPost, "/admin/ingress-domains", adminTok, map[string]any{
		"suffix": "need.test", "display_name": "Need", "require_approval": true, "enabled": true,
	})
	if need.Code != http.StatusCreated {
		t.Fatalf("create need zone: %d %s", need.Code, need.Body.String())
	}
	var needZone models.IngressDomainZone
	_ = json.Unmarshal(need.Body.Bytes(), &needZone)

	meta := doJSON(t, h, http.MethodGet, "/ingress/meta", adminTok, nil)
	if meta.Code != http.StatusOK {
		t.Fatalf("meta: %d", meta.Code)
	}
	var metaBody map[string]any
	_ = json.Unmarshal(meta.Body.Bytes(), &metaBody)
	if _, ok := metaBody["zones"]; !ok {
		t.Fatalf("meta missing zones: %s", meta.Body.String())
	}

	rr := doJSON(t, h, http.MethodPost, "/projects", adminTok, map[string]string{"name": "zoneproj", "slug": "zoneproj"})
	if rr.Code != http.StatusCreated {
		t.Fatal(rr.Body.String())
	}
	var p models.Project
	_ = json.Unmarshal(rr.Body.Bytes(), &p)
	_ = doJSON(t, h, http.MethodPost, "/projects/"+p.ID.String()+"/members", adminTok, map[string]string{
		"username": "zonedev", "role": "developer",
	})
	rr = doJSON(t, h, http.MethodPost, "/projects/"+p.ID.String()+"/workspaces", adminTok, map[string]string{
		"name": "zonews", "plan": "nano", "arch": "amd64",
	})
	if rr.Code != http.StatusCreated {
		t.Fatal(rr.Body.String())
	}
	var ws models.Workspace
	_ = json.Unmarshal(rr.Body.Bytes(), &ws)

	shared := doJSON(t, h, http.MethodPost, "/workspaces/"+ws.ID.String()+"/ingress/shared", devTok, map[string]any{
		"zone_id": zone.ID.String(), "mode": "custom", "prefix": "demo", "port": 8080,
	})
	if shared.Code != http.StatusCreated {
		t.Fatalf("shared claim: %d %s", shared.Code, shared.Body.String())
	}
	var route models.IngressRoute
	_ = json.Unmarshal(shared.Body.Bytes(), &route)
	if route.Status != models.IngressActive || route.Domain != "demo.apps.test" {
		t.Fatalf("unexpected shared route: %+v", route)
	}

	pending := doJSON(t, h, http.MethodPost, "/workspaces/"+ws.ID.String()+"/ingress", devTok, map[string]any{
		"zone_id": needZone.ID.String(), "prefix": "team", "port": 8081, "confirm_second_port": true,
	})
	if pending.Code != http.StatusCreated {
		t.Fatalf("need approval: %d %s", pending.Code, pending.Body.String())
	}
	var pendingRoute models.IngressRoute
	_ = json.Unmarshal(pending.Body.Bytes(), &pendingRoute)
	if pendingRoute.Status != models.IngressPendingApproval {
		t.Fatalf("expected pending, got %s", pendingRoute.Status)
	}
}

func TestBatchCreateUsersAPI(t *testing.T) {
	h := testServer(t)
	adminTok := registerLogin(t, h, "admin_batch", "admin_batch@x.com")

	// 1. 普通用户尝试无权限全局批量创建 -> 403 Forbidden
	normTok := registerLogin(t, h, "norm_batch", "norm_batch@x.com")
	resForbidden := doJSON(t, h, http.MethodPost, "/users/batch", normTok, map[string]any{
		"users": []map[string]string{
			{"username": "b1", "email": "b1@x.com"},
		},
		"default_password": "password123",
	})
	if resForbidden.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for normal user batch create without project, got %d", resForbidden.Code)
	}

	// 2. 项目 Owner 批量创建并加入当前项目 -> 200 OK
	resProj := doJSON(t, h, http.MethodPost, "/projects", normTok, map[string]string{"name": "BatchProj", "slug": "batch-proj"})
	if resProj.Code != http.StatusCreated {
		t.Fatal(resProj.Body.String())
	}
	var p models.Project
	_ = json.Unmarshal(resProj.Body.Bytes(), &p)

	resBatch := doJSON(t, h, http.MethodPost, "/users/batch", normTok, map[string]any{
		"project_id":       p.ID.String(),
		"project_role":     "developer",
		"default_password": "password123",
		"users": []map[string]string{
			{"username": "member1", "email": "m1@x.com"},
			{"username": "member2", "email": "m2@x.com", "password": "custompass2"},
			{"username": "invalid", "email": "not-an-email"},
		},
	})
	if resBatch.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d %s", resBatch.Code, resBatch.Body.String())
	}
	var batchResult struct {
		Total        int `json:"total"`
		CreatedCount int `json:"created_count"`
		FailedCount  int `json:"failed_count"`
	}
	_ = json.Unmarshal(resBatch.Body.Bytes(), &batchResult)
	if batchResult.Total != 3 || batchResult.CreatedCount != 2 || batchResult.FailedCount != 1 {
		t.Fatalf("unexpected batch result: %+v", batchResult)
	}

	_ = adminTok
}

func TestListUsersAPI(t *testing.T) {
	h := testServer(t)
	adminTok := registerLogin(t, h, "admin_users", "admin_users@x.com")
	devTok := registerLogin(t, h, "dev_users", "dev_users@x.com")

	forbidden := doJSON(t, h, http.MethodGet, "/users", devTok, nil)
	if forbidden.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-admin list users, got %d", forbidden.Code)
	}

	resProj := doJSON(t, h, http.MethodPost, "/projects", adminTok, map[string]string{"name": "UserList", "slug": "user-list"})
	if resProj.Code != http.StatusCreated {
		t.Fatal(resProj.Body.String())
	}
	var p models.Project
	_ = json.Unmarshal(resProj.Body.Bytes(), &p)

	add := doJSON(t, h, http.MethodPost, "/projects/"+p.ID.String()+"/members", adminTok, map[string]string{
		"username": "dev_users", "role": "developer",
	})
	if add.Code != http.StatusCreated {
		t.Fatalf("add member: %d %s", add.Code, add.Body.String())
	}

	listed := doJSON(t, h, http.MethodGet, "/users", adminTok, nil)
	if listed.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d %s", listed.Code, listed.Body.String())
	}
	var envelope struct {
		Data []struct {
			Username string `json:"username"`
			Projects []struct {
				Name string `json:"name"`
				Role string `json:"role"`
			} `json:"projects"`
		} `json:"data"`
	}
	if err := json.Unmarshal(listed.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if len(envelope.Data) < 2 {
		t.Fatalf("expected at least 2 users, got %d", len(envelope.Data))
	}
	var foundDev bool
	for _, u := range envelope.Data {
		if u.Username != "dev_users" {
			continue
		}
		foundDev = true
		if len(u.Projects) != 1 || u.Projects[0].Name != "UserList" || u.Projects[0].Role != "developer" {
			t.Fatalf("expected dev_users in UserList as developer, got %+v", u.Projects)
		}
	}
	if !foundDev {
		t.Fatal("dev_users missing from user list")
	}
}

func TestManageUsersAPI(t *testing.T) {
	h := testServer(t)
	adminTok := registerLogin(t, h, "admin_mgmt", "admin_mgmt@x.com")
	devTok := registerLogin(t, h, "dev_mgmt", "dev_mgmt@x.com")

	listed := doJSON(t, h, http.MethodGet, "/users", adminTok, nil)
	if listed.Code != http.StatusOK {
		t.Fatal(listed.Body.String())
	}
	var envelope struct {
		Data []struct {
			ID       string `json:"id"`
			Username string `json:"username"`
		} `json:"data"`
	}
	if err := json.Unmarshal(listed.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	var adminID, devID string
	for _, u := range envelope.Data {
		switch u.Username {
		case "admin_mgmt":
			adminID = u.ID
		case "dev_mgmt":
			devID = u.ID
		}
	}
	if adminID == "" || devID == "" {
		t.Fatal("missing users")
	}

	forbidden := doJSON(t, h, http.MethodPost, "/users/"+devID+"/suspend", devTok, nil)
	if forbidden.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d %s", forbidden.Code, forbidden.Body.String())
	}

	self := doJSON(t, h, http.MethodDelete, "/users/"+adminID, adminTok, nil)
	if self.Code == http.StatusNoContent {
		t.Fatal("should not delete last/self admin")
	}

	reset := doJSON(t, h, http.MethodPost, "/users/"+devID+"/reset-password", adminTok, map[string]string{})
	if reset.Code != http.StatusOK {
		t.Fatalf("reset %d %s", reset.Code, reset.Body.String())
	}
	var cred struct {
		Password string `json:"password"`
	}
	if err := json.Unmarshal(reset.Body.Bytes(), &cred); err != nil || cred.Password == "" {
		t.Fatalf("password missing: %s", reset.Body.String())
	}
	oldLogin := doJSON(t, h, http.MethodPost, "/auth/login", "", map[string]string{
		"username": "dev_mgmt", "password": "password1",
	})
	if oldLogin.Code != http.StatusUnauthorized {
		t.Fatalf("old password should fail, got %d", oldLogin.Code)
	}
	newLogin := doJSON(t, h, http.MethodPost, "/auth/login", "", map[string]string{
		"username": "dev_mgmt", "password": cred.Password,
	})
	if newLogin.Code != http.StatusOK {
		t.Fatalf("new password login %d %s", newLogin.Code, newLogin.Body.String())
	}

	sus := doJSON(t, h, http.MethodPost, "/users/"+devID+"/suspend", adminTok, nil)
	if sus.Code != http.StatusOK {
		t.Fatalf("suspend %d %s", sus.Code, sus.Body.String())
	}
	blocked := doJSON(t, h, http.MethodPost, "/auth/login", "", map[string]string{
		"username": "dev_mgmt", "password": cred.Password,
	})
	if blocked.Code != http.StatusUnauthorized {
		t.Fatalf("suspended login %d", blocked.Code)
	}

	role := doJSON(t, h, http.MethodPatch, "/users/"+devID, adminTok, map[string]string{"platform_role": "platform_ops"})
	if role.Code != http.StatusOK {
		t.Fatalf("patch %d %s", role.Code, role.Body.String())
	}

	unsus := doJSON(t, h, http.MethodPost, "/users/"+devID+"/unsuspend", adminTok, nil)
	if unsus.Code != http.StatusOK {
		t.Fatalf("unsuspend %d %s", unsus.Code, unsus.Body.String())
	}

	del := doJSON(t, h, http.MethodDelete, "/users/"+devID, adminTok, nil)
	if del.Code != http.StatusNoContent {
		t.Fatalf("delete %d %s", del.Code, del.Body.String())
	}
	after := doJSON(t, h, http.MethodGet, "/users", adminTok, nil)
	if err := json.Unmarshal(after.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	for _, u := range envelope.Data {
		if u.Username == "dev_mgmt" {
			t.Fatal("deleted user still listed")
		}
	}
}

func TestWorkspaceTerminalAuthAndEcho(t *testing.T) {
	h := testServer(t)
	tok := registerLogin(t, h, "term-owner", "term-owner@x.com")
	rr := doJSON(t, h, http.MethodPost, "/projects", tok, map[string]string{"name": "term-p", "slug": "term-p"})
	if rr.Code != http.StatusCreated {
		t.Fatal(rr.Body.String())
	}
	var p models.Project
	_ = json.Unmarshal(rr.Body.Bytes(), &p)
	rr = doJSON(t, h, http.MethodPost, "/projects/"+p.ID.String()+"/workspaces", tok, map[string]string{
		"name": "term-ws", "plan": "nano", "arch": "amd64",
	})
	if rr.Code != http.StatusCreated {
		t.Fatal(rr.Body.String())
	}
	var ws models.Workspace
	_ = json.Unmarshal(rr.Body.Bytes(), &ws)
	if ws.Status == models.WSRequested {
		rr = doJSON(t, h, http.MethodPost, "/workspaces/"+ws.ID.String()+"/approve", tok, map[string]string{})
		if rr.Code != http.StatusOK {
			t.Fatal(rr.Body.String())
		}
		_ = json.Unmarshal(rr.Body.Bytes(), &ws)
	}

	denied := doJSON(t, h, http.MethodGet, "/workspaces/"+ws.ID.String()+"/terminal", "", nil)
	if denied.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 got %d %s", denied.Code, denied.Body.String())
	}

	viewerTok := registerLogin(t, h, "term-view", "term-view@x.com")
	rr = doJSON(t, h, http.MethodPost, "/projects/"+p.ID.String()+"/members", tok, map[string]string{
		"username": "term-view", "role": "viewer",
	})
	if rr.Code != http.StatusCreated {
		t.Fatal(rr.Body.String())
	}
	forbid := doJSON(t, h, http.MethodGet, "/workspaces/"+ws.ID.String()+"/terminal", viewerTok, nil)
	if forbid.Code != http.StatusForbidden {
		t.Fatalf("want 403 got %d %s", forbid.Code, forbid.Body.String())
	}

	srv := httptest.NewServer(h)
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	u := "ws" + strings.TrimPrefix(srv.URL, "http") + "/workspaces/" + ws.ID.String() + "/terminal?access_token=" + tok
	c, _, err := websocket.Dial(ctx, u, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close(websocket.StatusNormalClosure, "")
	_, data, err := c.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "已连接") {
		t.Fatalf("banner %q", data)
	}
	if err := c.Write(ctx, websocket.MessageBinary, []byte("hi")); err != nil {
		t.Fatal(err)
	}
	_, echo, err := c.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if string(echo) != "hi" {
		t.Fatalf("echo %q", echo)
	}
}

func TestAccessTokenQueryOnlyOnTerminal(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/workspaces/x/terminal?access_token=abc", nil)
	if got := accessTokenFromRequest(req); got != "abc" {
		t.Fatalf("terminal query token %q", got)
	}
	req = httptest.NewRequest(http.MethodGet, "/api/workspaces/x/terminal?access_token=abc", nil)
	if got := accessTokenFromRequest(req); got != "abc" {
		t.Fatalf("api terminal query token %q", got)
	}
	req = httptest.NewRequest(http.MethodGet, "/workspaces/x/connection?access_token=abc", nil)
	if got := accessTokenFromRequest(req); got != "" {
		t.Fatalf("connection must not take query token, got %q", got)
	}
	req = httptest.NewRequest(http.MethodGet, "/workspaces/x/terminal", nil)
	req.Header.Set("Authorization", "Bearer hdr")
	if got := accessTokenFromRequest(req); got != "hdr" {
		t.Fatalf("bearer %q", got)
	}
}
