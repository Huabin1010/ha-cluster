package edge

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakePanel struct {
	mu        sync.Mutex
	key       string
	sites     map[string]int64
	proxies   map[string]bool
	calls     []string
	badToken  bool
	failApply bool
	certPEM   string
	sslKey    string
}

func (p *fakePanel) handler(t *testing.T) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		p.mu.Lock()
		defer p.mu.Unlock()
		action := r.URL.Query().Get("action")
		p.calls = append(p.calls, action)
		if r.Form.Get("request_token") != Sign(r.Form.Get("request_time"), p.key) {
			p.badToken = true
			_, _ = w.Write([]byte(`{"status":false,"msg":"签名错误"}`))
			return
		}
		switch action {
		case "getData":
			var rows []map[string]any
			for name, id := range p.sites {
				rows = append(rows, map[string]any{"id": id, "name": name, "path": "/www/wwwroot/" + name})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": rows})
		case "AddSite":
			var wn struct {
				Domain string `json:"domain"`
			}
			_ = json.Unmarshal([]byte(r.Form.Get("webname")), &wn)
			p.sites[wn.Domain] = int64(len(p.sites) + 10)
			_, _ = w.Write([]byte(`{"siteStatus":true}`))
		case "GetProxyList":
			if p.proxies[r.Form.Get("sitename")] {
				_, _ = w.Write([]byte(`[{"proxyname":"ha-edge"}]`))
				return
			}
			_, _ = w.Write([]byte(`[]`))
		case "CreateProxy", "ModifyProxy":
			if r.Form.Get("proxysite") != "http://127.0.0.1:18080" {
				t.Errorf("proxysite=%q", r.Form.Get("proxysite"))
			}
			p.proxies[r.Form.Get("sitename")] = true
			_, _ = w.Write([]byte(`{"status":true}`))
		case "apply_cert_api":
			if r.Form.Get("auth_type") != "http" {
				t.Errorf("auth_type=%q", r.Form.Get("auth_type"))
			}
			if p.failApply {
				_, _ = w.Write([]byte(`{"status":false,"msg":"验证失败：域名未解析到本机"}`))
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"status": true, "private_key": "KEY", "cert": p.certPEM, "root": ""})
		case "SetSSL":
			p.sslKey = r.Form.Get("key")
			_, _ = w.Write([]byte(`{"status":true}`))
		case "HttpToHttps":
			_, _ = w.Write([]byte(`{"status":true}`))
		case "DeleteSite":
			for name, id := range p.sites {
				if r.Form.Get("id") == itoa(id) {
					delete(p.sites, name)
				}
			}
			_, _ = w.Write([]byte(`{"status":true}`))
		default:
			t.Errorf("unexpected action %s", action)
		}
	}
}

func itoa(n int64) string { return strings.TrimSpace(big.NewInt(n).String()) }

func selfSigned(t *testing.T, notAfter time.Time) string {
	t.Helper()
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		// Self-signed: x509 takes Issuer from the parent's Subject.
		Subject:      pkix.Name{CommonName: "app.customer.com", Organization: []string{"Let's Encrypt"}},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     notAfter,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &k.PublicKey, k)
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
}

func newTestEdge(t *testing.T, p *fakePanel) *BaotaEdge {
	srv := httptest.NewServer(p.handler(t))
	t.Cleanup(srv.Close)
	return &BaotaEdge{Panel: srv.URL, Key: p.key, Target: "http://127.0.0.1:18080", RootDir: "/www/wwwroot", HTTP: srv.Client()}
}

func TestSign(t *testing.T) {
	// md5("1700000000" + md5("k")) computed independently.
	got := Sign("1700000000", "k")
	if len(got) != 32 {
		t.Fatalf("token %q", got)
	}
	if Sign("1700000000", "k") != got || Sign("1700000001", "k") == got {
		t.Fatal("sign not deterministic / not time dependent")
	}
}

func TestBaotaAttachIssueDetach(t *testing.T) {
	notAfter := time.Now().Add(90 * 24 * time.Hour).Truncate(time.Second)
	p := &fakePanel{key: "secret", sites: map[string]int64{}, proxies: map[string]bool{}, certPEM: selfSigned(t, notAfter)}
	e := newTestEdge(t, p)
	ctx := context.Background()

	if err := e.Attach(ctx, "App.Customer.com."); err != nil {
		t.Fatal(err)
	}
	want := []string{"getData", "AddSite", "GetProxyList", "CreateProxy"}
	if strings.Join(p.calls, ",") != strings.Join(want, ",") {
		t.Fatalf("calls=%v want %v", p.calls, want)
	}

	// Idempotent: second attach reuses site and modifies proxy.
	p.calls = nil
	if err := e.Attach(ctx, "app.customer.com"); err != nil {
		t.Fatal(err)
	}
	want = []string{"getData", "GetProxyList", "ModifyProxy"}
	if strings.Join(p.calls, ",") != strings.Join(want, ",") {
		t.Fatalf("re-attach calls=%v", p.calls)
	}

	p.calls = nil
	info, err := e.IssueCert(ctx, "app.customer.com")
	if err != nil {
		t.Fatal(err)
	}
	want = []string{"getData", "apply_cert_api", "SetSSL", "HttpToHttps"}
	if strings.Join(p.calls, ",") != strings.Join(want, ",") {
		t.Fatalf("issue calls=%v", p.calls)
	}
	if p.sslKey != "KEY" || info.Issuer != "Let's Encrypt" || info.NotAfter == nil || !info.NotAfter.Equal(notAfter) {
		t.Fatalf("info=%+v key=%q", info, p.sslKey)
	}

	if err := e.Detach(ctx, "app.customer.com"); err != nil {
		t.Fatal(err)
	}
	if len(p.sites) != 0 {
		t.Fatalf("site not deleted: %v", p.sites)
	}
	// Detach of unknown domain is a no-op.
	if err := e.Detach(ctx, "gone.customer.com"); err != nil {
		t.Fatal(err)
	}
	if p.badToken {
		t.Fatal("a request carried a bad signature")
	}
}

func TestBaotaIssueErrors(t *testing.T) {
	p := &fakePanel{key: "secret", sites: map[string]int64{}, proxies: map[string]bool{}, failApply: true}
	e := newTestEdge(t, p)
	ctx := context.Background()

	if _, err := e.IssueCert(ctx, "app.customer.com"); err == nil || !strings.Contains(err.Error(), "Attach") {
		t.Fatalf("want missing-site error, got %v", err)
	}
	if err := e.Attach(ctx, "app.customer.com"); err != nil {
		t.Fatal(err)
	}
	_, err := e.IssueCert(ctx, "app.customer.com")
	if err == nil || !strings.Contains(err.Error(), "未解析到本机") {
		t.Fatalf("want panel message passed through, got %v", err)
	}
}

func TestBaotaBadKey(t *testing.T) {
	p := &fakePanel{key: "secret", sites: map[string]int64{}, proxies: map[string]bool{}}
	e := newTestEdge(t, p)
	e.Key = "wrong"
	if err := e.Attach(context.Background(), "app.customer.com"); err == nil || !strings.Contains(err.Error(), "签名错误") {
		t.Fatalf("want signature error, got %v", err)
	}
}

func TestFromEnv(t *testing.T) {
	t.Setenv("HA_EDGE_PROVIDER", "")
	if FromEnv().Name() != "noop" {
		t.Fatal("default should be noop")
	}
	t.Setenv("HA_EDGE_PROVIDER", "baota")
	t.Setenv("HA_BT_PANEL", "")
	t.Setenv("HA_BT_KEY", "")
	if FromEnv().Name() != "noop" {
		t.Fatal("baota without creds should fall back to noop")
	}
	t.Setenv("HA_BT_PANEL", "http://panel:8888/")
	t.Setenv("HA_BT_KEY", "k")
	got := FromEnv()
	b, ok := got.(*BaotaEdge)
	if !ok || b.Panel != "http://panel:8888" || b.Target != "http://127.0.0.1:18080" {
		t.Fatalf("got %#v", got)
	}
}

func TestFakeEdge(t *testing.T) {
	f := &FakeEdge{}
	ctx := context.Background()
	_ = f.Attach(ctx, "a.b.com")
	_, _ = f.IssueCert(ctx, "a.b.com")
	_ = f.Detach(ctx, "a.b.com")
	if f.Count("attach", "a.b.com") != 1 || f.Count("issue", "a.b.com") != 1 || f.Count("detach", "a.b.com") != 1 {
		t.Fatal(f.Calls)
	}
	if _, err := (NoopEdge{}).IssueCert(ctx, "x.y.com"); err != ErrNoTLS {
		t.Fatal(err)
	}
}
