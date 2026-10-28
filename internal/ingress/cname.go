package ingress

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"sort"
	"strings"
	"time"
)

// Resolver is the subset of net.Resolver used for CNAME ownership checks.
// Tests inject a fake; production uses PublicResolver.
type Resolver interface {
	LookupCNAME(ctx context.Context, host string) (string, error)
	LookupHost(ctx context.Context, host string) ([]string, error)
}

// CNAME check outcomes. Codes are stable for API/UI mapping.
const (
	CNAMEOK          = "ok"
	CNAMENotFound    = "not_found"    // NXDOMAIN / no records yet
	CNAMEWrongTarget = "wrong_target" // points somewhere else
	CNAMEProxied     = "proxied"      // resolves to a CDN proxy (e.g. Cloudflare orange cloud)
	CNAMEApex        = "apex"         // registrable root domain, CNAME not allowed
	CNAMELookupError = "lookup_error" // resolver failure (timeout etc.)
	CNAMENoTarget    = "no_target"    // platform has no CNAME target configured
)

// CNAMEResult describes one verification attempt.
type CNAMEResult struct {
	OK      bool     `json:"ok"`
	Code    string   `json:"code"`
	Message string   `json:"message"`
	Actual  string   `json:"actual,omitempty"`
	IPs     []string `json:"ips,omitempty"`
}

func normHost(h string) string {
	return strings.TrimSuffix(strings.ToLower(strings.TrimSpace(h)), ".")
}

// CNAMETargets returns the platform hostnames users may CNAME to.
// HA_INGRESS_CNAME_TARGETS (comma separated) wins; otherwise fallback.
func CNAMETargets(fallback string) []string {
	raw := os.Getenv("HA_INGRESS_CNAME_TARGETS")
	var out []string
	seen := map[string]struct{}{}
	for _, p := range strings.Split(raw, ",") {
		p = normHost(p)
		if p == "" || net.ParseIP(p) != nil {
			continue
		}
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	if len(out) == 0 {
		fb := normHost(fallback)
		if fb != "" && net.ParseIP(fb) == nil {
			out = append(out, fb)
		}
	}
	return out
}

// RouteTargetLabel is the per-route DNS label users CNAME to:
// r-<first 10 hex of the route UUID>. Lowercase, stable, one DNS label.
func RouteTargetLabel(id fmt.Stringer) string {
	hex := strings.ReplaceAll(id.String(), "-", "")
	if len(hex) > 10 {
		hex = hex[:10]
	}
	return "r-" + strings.ToLower(hex)
}

// multiLabelSuffixes are public suffixes with two labels that are common for
// our users. A full PSL is overkill for an apex hint.
var multiLabelSuffixes = map[string]struct{}{
	"com.cn": {}, "net.cn": {}, "org.cn": {}, "gov.cn": {}, "edu.cn": {},
	"ac.cn": {}, "co.uk": {}, "org.uk": {}, "com.hk": {}, "com.tw": {},
	"co.jp": {}, "com.au": {}, "co.kr": {}, "com.sg": {},
}

// IsApexDomain reports whether d is a registrable root (example.com,
// example.com.cn), where most DNS providers forbid CNAME.
func IsApexDomain(d string) bool {
	d = normHost(d)
	parts := strings.Split(d, ".")
	if len(parts) < 2 {
		return false
	}
	if len(parts) == 2 {
		return true
	}
	if len(parts) == 3 {
		_, ok := multiLabelSuffixes[parts[1]+"."+parts[2]]
		return ok
	}
	return false
}

// SplitRecordHost returns (host record, zone) as users type them in DNS
// consoles: app.customer.com → ("app", "customer.com").
func SplitRecordHost(d string) (string, string) {
	d = normHost(d)
	parts := strings.Split(d, ".")
	n := 2
	if len(parts) >= 3 {
		if _, ok := multiLabelSuffixes[parts[len(parts)-2]+"."+parts[len(parts)-1]]; ok {
			n = 3
		}
	}
	if len(parts) <= n {
		return "@", d
	}
	return strings.Join(parts[:len(parts)-n], "."), strings.Join(parts[len(parts)-n:], ".")
}

// Cloudflare published IPv4 ranges (https://www.cloudflare.com/ips-v4).
var proxyCIDRs = mustCIDRs(
	"173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
	"141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
	"197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
	"104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
)

func mustCIDRs(cidrs ...string) []*net.IPNet {
	out := make([]*net.IPNet, 0, len(cidrs))
	for _, c := range cidrs {
		_, n, err := net.ParseCIDR(c)
		if err != nil {
			panic(err)
		}
		out = append(out, n)
	}
	return out
}

func isProxyIP(s string) bool {
	ip := net.ParseIP(s)
	if ip == nil {
		return false
	}
	for _, n := range proxyCIDRs {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

func isNotFound(err error) bool {
	var de *net.DNSError
	if errors.As(err, &de) {
		return de.IsNotFound
	}
	return false
}

// VerifyCNAME checks that domain is delegated to one of targets, either by a
// CNAME chain ending on a target, or (CNAME flattening / ALIAS) by resolving
// to exactly the target's addresses.
func VerifyCNAME(ctx context.Context, r Resolver, domain string, targets []string) CNAMEResult {
	return verifyCNAME(ctx, r, domain, targets, false)
}

// VerifyCNAMEStrict only accepts a real CNAME chain ending on a target. Used
// with per-route targets (r<id>.edge.<platform>): the exact value proves which
// route the DNS owner meant, so an A-record match (flattening) is not enough.
func VerifyCNAMEStrict(ctx context.Context, r Resolver, domain string, targets []string) CNAMEResult {
	return verifyCNAME(ctx, r, domain, targets, true)
}

func verifyCNAME(ctx context.Context, r Resolver, domain string, targets []string, strict bool) CNAMEResult {
	domain = normHost(domain)
	if len(targets) == 0 {
		return CNAMEResult{Code: CNAMENoTarget, Message: "平台尚未配置 CNAME 入口（HA_INGRESS_CNAME_TARGETS）"}
	}
	want := map[string]struct{}{}
	for _, t := range targets {
		want[normHost(t)] = struct{}{}
	}
	primary := normHost(targets[0])

	cname, cerr := r.LookupCNAME(ctx, domain)
	cname = normHost(cname)
	if cerr == nil && cname != "" && cname != domain {
		if _, ok := want[cname]; ok {
			return CNAMEResult{OK: true, Code: CNAMEOK, Message: "CNAME 已指向平台入口 " + cname, Actual: cname}
		}
	}

	ips, herr := r.LookupHost(ctx, domain)
	if herr != nil {
		if isNotFound(herr) || isNotFound(cerr) {
			res := CNAMEResult{Code: CNAMENotFound, Message: "还没有查到 " + domain + " 的解析记录，请添加 CNAME 指向 " + primary + "（刚添加可能需要几分钟生效）"}
			if IsApexDomain(domain) {
				res.Code = CNAMEApex
				res.Message = domain + " 是根域，多数 DNS 不允许根域设置 CNAME，请改用子域（如 www." + domain + "）"
			}
			return res
		}
		return CNAMEResult{Code: CNAMELookupError, Message: "DNS 查询失败：" + herr.Error()}
	}
	sort.Strings(ips)

	// CNAME flattening / ALIAS: domain resolves to the same IP set as a target.
	for t := range want {
		if strict {
			break
		}
		tips, err := r.LookupHost(ctx, t)
		if err != nil || len(tips) == 0 {
			continue
		}
		if sameSet(ips, tips) {
			return CNAMEResult{OK: true, Code: CNAMEOK, Message: "解析结果与平台入口一致（CNAME 拉平 / ALIAS）", IPs: ips}
		}
	}

	for _, ip := range ips {
		if isProxyIP(ip) {
			return CNAMEResult{Code: CNAMEProxied, IPs: ips, Actual: cname,
				Message: domain + " 解析到 Cloudflare 代理地址，请在 Cloudflare 把该记录切换为「仅 DNS」（灰色云朵）"}
		}
	}

	if IsApexDomain(domain) {
		return CNAMEResult{Code: CNAMEApex, IPs: ips, Actual: cname,
			Message: domain + " 是根域，多数 DNS 不允许根域设置 CNAME，请改用子域（如 www." + domain + "），或使用支持 CNAME 拉平的 DNS"}
	}
	actual := cname
	if actual == "" || actual == domain {
		actual = strings.Join(ips, ", ")
	}
	return CNAMEResult{Code: CNAMEWrongTarget, Actual: actual, IPs: ips,
		Message: domain + " 当前指向 " + actual + "，应为 CNAME " + primary}
}

func sameSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	m := map[string]struct{}{}
	for _, x := range a {
		m[x] = struct{}{}
	}
	for _, y := range b {
		if _, ok := m[y]; !ok {
			return false
		}
	}
	return true
}

// PublicResolver queries public recursive DNS directly so results do not
// depend on the container's /etc/resolv.conf or split-horizon overrides.
func PublicResolver() Resolver {
	servers := []string{"223.5.5.5:53", "119.29.29.29:53"}
	if v := strings.TrimSpace(os.Getenv("HA_INGRESS_DNS_SERVERS")); v != "" {
		servers = nil
		for _, s := range strings.Split(v, ",") {
			s = strings.TrimSpace(s)
			if s == "" {
				continue
			}
			if _, _, err := net.SplitHostPort(s); err != nil {
				s = net.JoinHostPort(s, "53")
			}
			servers = append(servers, s)
		}
	}
	return &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			d := net.Dialer{Timeout: 3 * time.Second}
			var last error
			for _, s := range servers {
				c, err := d.DialContext(ctx, network, s)
				if err == nil {
					return c, nil
				}
				last = err
			}
			return nil, last
		},
	}
}
