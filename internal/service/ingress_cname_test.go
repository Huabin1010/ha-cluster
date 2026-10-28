package service

import (
	"context"
	"errors"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"ha-cluster/internal/edge"
	"ha-cluster/internal/ingress"
	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

const testCNAMEBase = "edge.cl.qzsyzn.com"

// dnsFake maps a domain to its CNAME value. Every CNAME target resolves to
// the edge IP, like real DNS does for our per-route targets.
type dnsFake struct {
	mu    sync.Mutex
	cname map[string]string
}

func (d *dnsFake) set(domain, target string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if target == "" {
		delete(d.cname, domain)
		return
	}
	d.cname[domain] = target
}

func (d *dnsFake) LookupCNAME(_ context.Context, host string) (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	if c, ok := d.cname[host]; ok {
		return c + ".", nil
	}
	return "", &net.DNSError{Err: "no such host", Name: host, IsNotFound: true}
}

func (d *dnsFake) LookupHost(_ context.Context, host string) ([]string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	if _, ok := d.cname[host]; ok {
		return []string{"42.193.236.123"}, nil
	}
	return nil, &net.DNSError{Err: "no such host", Name: host, IsNotFound: true}
}

type cnameFixture struct {
	app   *App
	owner *models.User
	dev   *models.User
	ws    *models.Workspace
	dns   *dnsFake
	edge  *edge.FakeEdge
}

func newCNAMEFixture(t *testing.T) *cnameFixture {
	t.Helper()
	t.Setenv("HA_INGRESS_CNAME_TARGETS", testCNAMEBase)
	t.Setenv("HA_INGRESS_DIR", "")
	app, owner := setupApp(t)
	ctx := context.Background()
	dns := &dnsFake{cname: map[string]string{}}
	fe := &edge.FakeEdge{}
	app.Resolver = dns
	app.Edge = fe

	p, err := app.CreateProject(ctx, owner.ID, "proj-cname", "pc", "test purpose")
	if err != nil {
		t.Fatal(err)
	}
	dev, err := app.Register(ctx, "devcname", "devcname@x.com", "password1")
	if err != nil {
		t.Fatal(err)
	}
	if err := app.Store.AddMembership(ctx, models.Membership{ProjectID: p.ID, UserID: dev.ID, Role: models.RoleDeveloper}); err != nil {
		t.Fatal(err)
	}
	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "web", Plan: "nano", Arch: models.ArchAMD64,
		Visibility: models.VisShared, Actor: *owner,
	})
	if err != nil {
		t.Fatal(err)
	}
	ws.Status = models.WSRunning
	if err := app.Store.UpdateWorkspace(ctx, ws); err != nil {
		t.Fatal(err)
	}
	return &cnameFixture{app: app, owner: owner, dev: dev, ws: ws, dns: dns, edge: fe}
}

func (f *cnameFixture) create(t *testing.T, domain string) *models.IngressRoute {
	t.Helper()
	r, err := f.app.CreateIngress(context.Background(), CreateIngressInput{
		WorkspaceID: f.ws.ID, Domain: domain, Port: 8080,
		VerifyKind: models.IngressVerifyCNAME, Actor: *f.dev,
	})
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestCustomDomainCNAMEHappyPath(t *testing.T) {
	f := newCNAMEFixture(t)
	ctx := context.Background()

	r := f.create(t, "App.Customer.com")
	if r.Status != models.IngressPendingDNS {
		t.Fatalf("developer cname route must wait for DNS, got %s", r.Status)
	}
	if r.Domain != "app.customer.com" {
		t.Fatalf("domain not normalized: %s", r.Domain)
	}
	want := ingress.RouteTargetLabel(r.ID) + "." + testCNAMEBase
	if r.CNAMETarget != want || r.RecordHost != "app" || r.RecordZone != "customer.com" {
		t.Fatalf("record: target=%s host=%s zone=%s", r.CNAMETarget, r.RecordHost, r.RecordZone)
	}
	if !strings.Contains(r.DNSHint, want) {
		t.Fatalf("hint must show cname value: %s", r.DNSHint)
	}
	if f.edge.Count("attach", r.Domain) != 0 {
		t.Fatal("edge must not be touched before DNS is verified")
	}

	// Not yet added at the DNS provider.
	got, err := f.app.VerifyIngressDNS(ctx, *f.dev, r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != models.IngressPendingDNS || got.DNSCode != ingress.CNAMENotFound || got.DNSCheckedAt == nil {
		t.Fatalf("want pending not_found, got %s %s", got.Status, got.DNSCode)
	}

	// User adds the record.
	f.dns.set("app.customer.com", want)
	got, err = f.app.VerifyIngressDNS(ctx, *f.dev, r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != models.IngressActive || got.DNSCode != ingress.CNAMEOK || got.DNSError != "" {
		t.Fatalf("want active, got %s %s %q", got.Status, got.DNSCode, got.DNSError)
	}
	if got.TLSStatus != models.IngressTLSIssued {
		t.Fatalf("want tls issued, got %s (%s)", got.TLSStatus, got.TLSError)
	}
	if f.edge.Count("attach", r.Domain) != 1 || f.edge.Count("issue", r.Domain) != 1 {
		t.Fatalf("edge calls: %v", f.edge.Calls)
	}

	// A second verify on an active route does not re-issue.
	if _, err := f.app.VerifyIngressDNS(ctx, *f.dev, r.ID); err != nil {
		t.Fatal(err)
	}
	if f.edge.Count("issue", r.Domain) != 1 {
		t.Fatalf("re-verify must not re-issue: %v", f.edge.Calls)
	}

	if err := f.app.DeleteIngress(ctx, *f.dev, r.ID); err != nil {
		t.Fatal(err)
	}
	if f.edge.Count("detach", r.Domain) != 1 {
		t.Fatalf("delete must detach from edge: %v", f.edge.Calls)
	}
}

func TestCustomDomainSharedTargetIsNotEnough(t *testing.T) {
	f := newCNAMEFixture(t)
	r := f.create(t, "app.customer.com")
	// Pointing at the shared base proves nothing about which route is meant.
	f.dns.set("app.customer.com", testCNAMEBase)
	got, err := f.app.VerifyIngressDNS(context.Background(), *f.dev, r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != models.IngressPendingDNS || got.DNSCode != ingress.CNAMEWrongTarget {
		t.Fatalf("want wrong_target, got %s %s", got.Status, got.DNSCode)
	}
	if !strings.Contains(got.DNSError, r.CNAMETarget) {
		t.Fatalf("error must name the expected target: %s", got.DNSError)
	}
}

func TestCustomDomainCreateValidation(t *testing.T) {
	f := newCNAMEFixture(t)
	ctx := context.Background()
	for _, d := range []string{"customer.com", "shop.com.cn", "x.edge.cl.qzsyzn.com", "admin.customer.com"} {
		_, err := f.app.CreateIngress(ctx, CreateIngressInput{
			WorkspaceID: f.ws.ID, Domain: d, Port: 8080,
			VerifyKind: models.IngressVerifyCNAME, Actor: *f.dev,
		})
		if !errors.Is(err, store.ErrInvalidInput) {
			t.Fatalf("%s: want invalid input, got %v", d, err)
		}
	}
	_, err := f.app.CreateIngress(ctx, CreateIngressInput{
		WorkspaceID: f.ws.ID, Domain: "app.customer.com", Port: 8080,
		VerifyKind: "txt", Actor: *f.dev,
	})
	if !errors.Is(err, store.ErrInvalidInput) {
		t.Fatalf("unknown verify_kind: %v", err)
	}

	// No CNAME base configured → feature disabled with a clear reason.
	t.Setenv("HA_INGRESS_CNAME_TARGETS", "")
	t.Setenv("HA_INGRESS_PUBLIC_HOST", "1.2.3.4")
	_, err = f.app.CreateIngress(ctx, CreateIngressInput{
		WorkspaceID: f.ws.ID, Domain: "app.customer.com", Port: 8080,
		VerifyKind: models.IngressVerifyCNAME, Actor: *f.dev,
	})
	if !errors.Is(err, store.ErrInvalidInput) || !strings.Contains(err.Error(), "CNAME") {
		t.Fatalf("want disabled reason, got %v", err)
	}
}

func TestCustomDomainDuplicateAndAccess(t *testing.T) {
	f := newCNAMEFixture(t)
	ctx := context.Background()
	r := f.create(t, "app.customer.com")

	_, err := f.app.CreateIngress(ctx, CreateIngressInput{
		WorkspaceID: f.ws.ID, Domain: "app.customer.com", Port: 8080,
		VerifyKind: models.IngressVerifyCNAME, Actor: *f.dev,
	})
	if !errors.Is(err, store.ErrConflict) {
		t.Fatalf("duplicate domain: want conflict, got %v", err)
	}

	outsider, err := f.app.Register(ctx, "outsider", "out@x.com", "password1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.app.VerifyIngressDNS(ctx, *outsider, r.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("non-member must get not found, got %v", err)
	}

	// Verify is only for CNAME routes.
	plain, err := f.app.CreateIngress(ctx, CreateIngressInput{
		WorkspaceID: f.ws.ID, Domain: "plain.customer.com", Port: 8080, Actor: *f.owner,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.app.VerifyIngressDNS(ctx, *f.owner, plain.ID); !errors.Is(err, store.ErrInvalidInput) {
		t.Fatalf("verify on non-cname route: %v", err)
	}
}

func TestCustomDomainBackgroundVerifier(t *testing.T) {
	f := newCNAMEFixture(t)
	ctx := context.Background()
	r := f.create(t, "app.customer.com")
	stale := f.create(t, "stale.customer.com")

	f.dns.set("app.customer.com", r.CNAMETarget)
	now := time.Now()
	verified, expired := f.app.VerifyPendingCustomDomains(ctx, now)
	if verified != 1 || expired != 0 {
		t.Fatalf("verified=%d expired=%d", verified, expired)
	}
	got, _ := f.app.Store.GetIngress(ctx, r.ID)
	if got.Status != models.IngressActive || got.TLSStatus != models.IngressTLSIssued {
		t.Fatalf("background verify: %s %s", got.Status, got.TLSStatus)
	}

	// User removes the CNAME later: route stays, error is surfaced on re-check.
	f.dns.set("app.customer.com", "")
	f.app.VerifyPendingCustomDomains(ctx, now.Add(cnameActiveRecheck+time.Minute))
	got, _ = f.app.Store.GetIngress(ctx, r.ID)
	if got.Status != models.IngressActive || got.DNSCode != ingress.CNAMENotFound || got.DNSError == "" {
		t.Fatalf("revoked cname: %s %s %q", got.Status, got.DNSCode, got.DNSError)
	}

	// Never-verified route is released after the expiry window.
	_, expired = f.app.VerifyPendingCustomDomains(ctx, now.Add(cnamePendingExpiry+time.Hour))
	if expired != 1 {
		t.Fatalf("expired=%d", expired)
	}
	if _, err := f.app.Store.GetIngress(ctx, stale.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("stale pending route should be deleted: %v", err)
	}
	if _, err := f.app.Store.GetIngress(ctx, r.ID); err != nil {
		t.Fatalf("active route must never expire: %v", err)
	}
}

func TestCustomDomainTLSFailureAndRetry(t *testing.T) {
	f := newCNAMEFixture(t)
	ctx := context.Background()
	f.edge.IssueErr = errors.New("acme: http-01 challenge failed")
	r := f.create(t, "app.customer.com")
	f.dns.set("app.customer.com", r.CNAMETarget)

	got, err := f.app.VerifyIngressDNS(ctx, *f.dev, r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != models.IngressActive || got.TLSStatus != models.IngressTLSFailed || !strings.Contains(got.TLSError, "http-01") {
		t.Fatalf("want active + tls failed, got %s %s %q", got.Status, got.TLSStatus, got.TLSError)
	}

	// Edge recovers; the「立即检测」button retries the certificate.
	f.edge.IssueErr = nil
	got, err = f.app.VerifyIngressDNS(ctx, *f.dev, r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.TLSStatus != models.IngressTLSIssued || got.TLSError != "" {
		t.Fatalf("retry: %s %q", got.TLSStatus, got.TLSError)
	}
}

func TestCustomDomainNoopEdgeSkipsTLS(t *testing.T) {
	f := newCNAMEFixture(t)
	f.app.Edge = edge.NoopEdge{}
	r := f.create(t, "app.customer.com")
	f.dns.set("app.customer.com", r.CNAMETarget)
	got, err := f.app.VerifyIngressDNS(context.Background(), *f.dev, r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != models.IngressActive || got.TLSStatus != models.IngressTLSSkipped {
		t.Fatalf("noop edge: %s %s", got.Status, got.TLSStatus)
	}
}

func TestIngressMetaAdvertisesCNAME(t *testing.T) {
	f := newCNAMEFixture(t)
	meta := f.app.IngressPublicInfo(context.Background())
	if meta["cname_enabled"] != true || meta["cname_base"] != testCNAMEBase || meta["edge_provider"] != "fake" {
		t.Fatalf("meta: %v", meta)
	}
}
