package ingress

import (
	"context"
	"errors"
	"net"
	"strings"
	"testing"
)

// fakeResolver emulates net.Resolver: LookupCNAME follows the whole chain and
// returns the final canonical name (or the host itself when it has addresses).
type fakeResolver struct {
	cname map[string]string
	hosts map[string][]string
	fail  error
}

func (f *fakeResolver) canon(h string) string {
	h = normHost(h)
	for i := 0; i < 10; i++ {
		next, ok := f.cname[h]
		if !ok {
			return h
		}
		h = normHost(next)
	}
	return h
}

func (f *fakeResolver) LookupCNAME(_ context.Context, host string) (string, error) {
	if f.fail != nil {
		return "", f.fail
	}
	c := f.canon(host)
	if _, ok := f.hosts[c]; !ok && c == normHost(host) {
		return "", &net.DNSError{Err: "no such host", Name: host, IsNotFound: true}
	}
	return c + ".", nil
}

func (f *fakeResolver) LookupHost(_ context.Context, host string) ([]string, error) {
	if f.fail != nil {
		return nil, f.fail
	}
	ips, ok := f.hosts[f.canon(host)]
	if !ok {
		return nil, &net.DNSError{Err: "no such host", Name: host, IsNotFound: true}
	}
	return ips, nil
}

const edge = "edge.cl.qzsyzn.com"

func TestVerifyCNAME(t *testing.T) {
	base := map[string][]string{edge: {"42.193.236.123"}}
	cases := []struct {
		name    string
		domain  string
		cname   map[string]string
		hosts   map[string][]string
		fail    error
		targets []string
		ok      bool
		code    string
		msgHas  string
	}{
		{name: "direct", domain: "app.customer.com", cname: map[string]string{"app.customer.com": edge}, ok: true, code: CNAMEOK},
		{name: "trailing dot and case", domain: "APP.Customer.com.", cname: map[string]string{"app.customer.com": "EDGE.cl.qzsyzn.com."}, ok: true, code: CNAMEOK},
		{name: "multi-level chain", domain: "app.customer.com", cname: map[string]string{"app.customer.com": "cdn.customer.com", "cdn.customer.com": edge}, ok: true, code: CNAMEOK},
		{name: "second target", domain: "app.customer.com", cname: map[string]string{"app.customer.com": "edge2.cl.qzsyzn.com"}, hosts: map[string][]string{"edge2.cl.qzsyzn.com": {"1.2.3.4"}}, targets: []string{edge, "edge2.cl.qzsyzn.com"}, ok: true, code: CNAMEOK},
		{name: "flattened A matches", domain: "customer.com", hosts: map[string][]string{"customer.com": {"42.193.236.123"}}, ok: true, code: CNAMEOK, msgHas: "拉平"},
		{name: "wrong target", domain: "app.customer.com", cname: map[string]string{"app.customer.com": "other.host.net"}, hosts: map[string][]string{"other.host.net": {"8.8.8.8"}}, code: CNAMEWrongTarget, msgHas: "other.host.net"},
		{name: "wrong A record", domain: "app.customer.com", hosts: map[string][]string{"app.customer.com": {"9.9.9.9"}}, code: CNAMEWrongTarget, msgHas: "9.9.9.9"},
		{name: "nxdomain", domain: "app.customer.com", code: CNAMENotFound, msgHas: edge},
		{name: "apex nxdomain", domain: "customer.com", code: CNAMEApex, msgHas: "www.customer.com"},
		{name: "apex wrong A", domain: "customer.com.cn", hosts: map[string][]string{"customer.com.cn": {"9.9.9.9"}}, code: CNAMEApex},
		{name: "cloudflare proxied", domain: "app.customer.com", hosts: map[string][]string{"app.customer.com": {"104.21.3.4"}}, code: CNAMEProxied, msgHas: "Cloudflare"},
		{name: "resolver failure", domain: "app.customer.com", fail: errors.New("i/o timeout"), code: CNAMELookupError},
		{name: "no targets", domain: "app.customer.com", targets: []string{}, code: CNAMENoTarget},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			hosts := map[string][]string{}
			for k, v := range base {
				hosts[k] = v
			}
			for k, v := range tc.hosts {
				hosts[k] = v
			}
			r := &fakeResolver{cname: tc.cname, hosts: hosts, fail: tc.fail}
			targets := tc.targets
			if targets == nil {
				targets = []string{edge}
			}
			got := VerifyCNAME(context.Background(), r, tc.domain, targets)
			if got.OK != tc.ok || got.Code != tc.code {
				t.Fatalf("got ok=%v code=%s msg=%q; want ok=%v code=%s", got.OK, got.Code, got.Message, tc.ok, tc.code)
			}
			if tc.msgHas != "" && !strings.Contains(got.Message, tc.msgHas) {
				t.Fatalf("message %q missing %q", got.Message, tc.msgHas)
			}
		})
	}
}

func TestIsApexDomain(t *testing.T) {
	for d, want := range map[string]bool{
		"customer.com": true, "customer.com.cn": true, "Customer.CO.UK.": true,
		"app.customer.com": false, "a.b.customer.com.cn": false, "com": false,
	} {
		if got := IsApexDomain(d); got != want {
			t.Errorf("IsApexDomain(%q)=%v want %v", d, got, want)
		}
	}
}

func TestSplitRecordHost(t *testing.T) {
	for d, want := range map[string][2]string{
		"app.customer.com":     {"app", "customer.com"},
		"a.b.customer.com":     {"a.b", "customer.com"},
		"shop.customer.com.cn": {"shop", "customer.com.cn"},
		"customer.com":         {"@", "customer.com"},
		"WWW.Customer.Com.":    {"www", "customer.com"},
	} {
		h, z := SplitRecordHost(d)
		if h != want[0] || z != want[1] {
			t.Errorf("SplitRecordHost(%q)=(%q,%q) want %v", d, h, z, want)
		}
	}
}

func TestCNAMETargets(t *testing.T) {
	t.Setenv("HA_INGRESS_CNAME_TARGETS", " Edge.cl.qzsyzn.com. ,edge2.example.com,edge.cl.qzsyzn.com,1.2.3.4")
	got := CNAMETargets("fallback.example.com")
	if strings.Join(got, ",") != "edge.cl.qzsyzn.com,edge2.example.com" {
		t.Fatalf("got %v", got)
	}
	t.Setenv("HA_INGRESS_CNAME_TARGETS", "")
	if got := CNAMETargets("fb.example.com"); len(got) != 1 || got[0] != "fb.example.com" {
		t.Fatalf("fallback: %v", got)
	}
	if got := CNAMETargets("106.52.109.127"); len(got) != 0 {
		t.Fatalf("IP fallback must not be a CNAME target: %v", got)
	}
}
