package api

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"ha-cluster/internal/edge"
	"ha-cluster/internal/models"
	"ha-cluster/internal/service"
	"ha-cluster/internal/store/memory"
	"ha-cluster/internal/workspace"
)

type apiDNSFake struct {
	mu    sync.Mutex
	cname map[string]string
}

func (d *apiDNSFake) set(domain, target string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.cname[domain] = target
}

func (d *apiDNSFake) LookupCNAME(_ context.Context, host string) (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	if c, ok := d.cname[host]; ok {
		return c + ".", nil
	}
	return "", &net.DNSError{Err: "no such host", Name: host, IsNotFound: true}
}

func (d *apiDNSFake) LookupHost(_ context.Context, host string) ([]string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	if _, ok := d.cname[host]; ok {
		return []string{"42.193.236.123"}, nil
	}
	return nil, &net.DNSError{Err: "no such host", Name: host, IsNotFound: true}
}

func cnameTestServer(t *testing.T) (http.Handler, *apiDNSFake, *edge.FakeEdge) {
	t.Helper()
	t.Setenv("HA_BASTION_HOST", "bastion.mnnumath.vip")
	t.Setenv("HA_BASTION_PORT", "8099")
	t.Setenv("HA_BASTION_DIRECT", "0")
	t.Setenv("HA_AGENT_VIA_LAN", "0")
	t.Setenv("HA_PROVISION_SYNC", "1")
	t.Setenv("HA_K8S_MEMORY", "1")
	t.Setenv("HA_KUBECONFIG", "")
	t.Setenv("HA_INGRESS_DIR", "")
	t.Setenv("HA_INGRESS_CNAME_TARGETS", "edge.cl.qzsyzn.com")
	st := memory.New()
	app := service.New(st, workspace.NewMemoryRuntime(), []byte("unit-test-secret-key-32b!!"))
	dns := &apiDNSFake{cname: map[string]string{}}
	fe := &edge.FakeEdge{}
	app.Resolver = dns
	app.Edge = fe
	const Gi = 1024 * 1024 * 1024
	_ = st.UpsertNode(t.Context(), &models.Node{
		ID: uuid.New(), Name: "pc1", Arch: models.ArchAMD64, Role: "worker", Power: "mains",
		AllocatableCPU: 8000, AllocatableMem: 2 * Gi, AllocatableDisk: 200 * Gi,
		Ready: true, FabricIP: "10.88.0.10", LanIP: "192.168.1.82", Tags: []string{"k3s"},
	})
	return New(app), dns, fe
}

func TestCustomDomainCNAMEAPI(t *testing.T) {
	h, dns, fe := cnameTestServer(t)
	ownerTok := registerLogin(t, h, "cnowner", "cnowner@x.com")
	devTok := registerLogin(t, h, "cndev", "cndev@x.com")
	outsiderTok := registerLogin(t, h, "cnout", "cnout@x.com")

	rr := doJSON(t, h, http.MethodPost, "/projects", ownerTok, map[string]string{"name": "cnproj", "slug": "cnproj", "purpose": "test purpose"})
	if rr.Code != http.StatusCreated {
		t.Fatal(rr.Body.String())
	}
	var p models.Project
	_ = json.Unmarshal(rr.Body.Bytes(), &p)
	rr = doJSON(t, h, http.MethodPost, "/projects/"+p.ID.String()+"/members", ownerTok, map[string]string{
		"username": "cndev", "role": "developer",
	})
	if rr.Code != http.StatusCreated {
		t.Fatal(rr.Body.String())
	}
	rr = doJSON(t, h, http.MethodPost, "/projects/"+p.ID.String()+"/workspaces", ownerTok, map[string]string{
		"name": "cnws", "plan": "nano", "arch": "amd64",
	})
	if rr.Code != http.StatusCreated {
		t.Fatal(rr.Body.String())
	}
	var ws models.Workspace
	_ = json.Unmarshal(rr.Body.Bytes(), &ws)
	base := "/workspaces/" + ws.ID.String() + "/ingress"

	// meta advertises CNAME support.
	meta := doJSON(t, h, http.MethodGet, "/ingress/meta", devTok, nil)
	if meta.Code != http.StatusOK || !strings.Contains(meta.Body.String(), `"cname_enabled":true`) {
		t.Fatalf("meta: %d %s", meta.Code, meta.Body.String())
	}

	// Apex domain is rejected with 400.
	apex := doJSON(t, h, http.MethodPost, base, devTok, map[string]any{
		"domain": "customer.com", "port": 8080, "verify_kind": "cname",
	})
	if apex.Code != http.StatusBadRequest {
		t.Fatalf("apex: want 400, got %d %s", apex.Code, apex.Body.String())
	}

	// Developer creates a custom domain: pending_dns with a CNAME target, no approval.
	cr := doJSON(t, h, http.MethodPost, base, devTok, map[string]any{
		"domain": "app.customer.com", "port": 8080, "verify_kind": "cname",
	})
	if cr.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", cr.Code, cr.Body.String())
	}
	var r1 models.IngressRoute
	_ = json.Unmarshal(cr.Body.Bytes(), &r1)
	if r1.Status != models.IngressPendingDNS {
		t.Fatalf("want pending_dns, got %s", r1.Status)
	}
	if !strings.HasSuffix(r1.CNAMETarget, ".edge.cl.qzsyzn.com") || r1.RecordHost != "app" {
		t.Fatalf("bad record: target=%q host=%q", r1.CNAMETarget, r1.RecordHost)
	}

	verifyPath := "/ingress/" + r1.ID.String() + "/verify"

	// Not yet pointed: still pending, with a reason.
	v := doJSON(t, h, http.MethodPost, verifyPath, devTok, nil)
	if v.Code != http.StatusOK {
		t.Fatalf("verify: %d %s", v.Code, v.Body.String())
	}
	var pending models.IngressRoute
	_ = json.Unmarshal(v.Body.Bytes(), &pending)
	if pending.Status != models.IngressPendingDNS || pending.DNSCode == "" {
		t.Fatalf("want pending with code, got %s code=%q", pending.Status, pending.DNSCode)
	}

	// Outsider cannot see the route.
	if o := doJSON(t, h, http.MethodPost, verifyPath, outsiderTok, nil); o.Code != http.StatusNotFound && o.Code != http.StatusForbidden {
		t.Fatalf("outsider: want 404/403, got %d %s", o.Code, o.Body.String())
	}

	// CNAME in place: active, TLS issued, edge called once each.
	dns.set("app.customer.com", r1.CNAMETarget)
	v = doJSON(t, h, http.MethodPost, verifyPath, devTok, nil)
	if v.Code != http.StatusOK {
		t.Fatalf("verify2: %d %s", v.Code, v.Body.String())
	}
	var active models.IngressRoute
	_ = json.Unmarshal(v.Body.Bytes(), &active)
	if active.Status != models.IngressActive {
		t.Fatalf("want active, got %s (%s)", active.Status, active.DNSError)
	}
	if active.TLSStatus != models.IngressTLSIssued {
		t.Fatalf("want tls issued, got %s (%s)", active.TLSStatus, active.TLSError)
	}
	if fe.Count("attach", "app.customer.com") != 1 || fe.Count("issue", "app.customer.com") != 1 {
		t.Fatalf("edge calls: %+v", fe.Calls)
	}

	// Verify on a non-CNAME route is a 400.
	sh := doJSON(t, h, http.MethodPost, base, devTok, map[string]any{
		"domain": "other.domain.com", "port": 8080,
	})
	if sh.Code == http.StatusCreated {
		var r2 models.IngressRoute
		_ = json.Unmarshal(sh.Body.Bytes(), &r2)
		bad := doJSON(t, h, http.MethodPost, "/ingress/"+r2.ID.String()+"/verify", devTok, nil)
		if bad.Code != http.StatusBadRequest {
			t.Fatalf("non-cname verify: want 400, got %d %s", bad.Code, bad.Body.String())
		}
	}

	// Bad id is 400.
	if b := doJSON(t, h, http.MethodPost, "/ingress/not-a-uuid/verify", devTok, nil); b.Code != http.StatusBadRequest {
		t.Fatalf("bad id: %d", b.Code)
	}

	// Delete detaches the edge site.
	if d := doJSON(t, h, http.MethodDelete, "/ingress/"+r1.ID.String(), ownerTok, nil); d.Code != http.StatusNoContent {
		t.Fatalf("delete: %d %s", d.Code, d.Body.String())
	}
	if fe.Count("detach", "app.customer.com") != 1 {
		t.Fatalf("detach calls: %+v", fe.Calls)
	}
}
