package requestmeta

import (
	"context"
	"net"
	"net/http"
	"strings"
)

type ctxKey int

const clientIPKey ctxKey = 1

func WithClientIP(ctx context.Context, ip string) context.Context {
	if ip == "" {
		return ctx
	}
	return context.WithValue(ctx, clientIPKey, ip)
}

func ClientIP(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	s, _ := ctx.Value(clientIPKey).(string)
	return s
}

// FromRequest returns the user-facing client IP.
//
// Production path is Browser → Baota → edge-nginx (Docker) → ha-api.
// Edge overwrites X-Real-IP with the compose gateway (172.28.90.1) but appends
// to X-Forwarded-For. Walk hops from the right, skip private/loopback proxies,
// and keep the first remaining address so spoofed leftmost XFF is ignored when
// the peer is already a public IP.
func FromRequest(r *http.Request) string {
	if r == nil {
		return ""
	}
	hops := headerHops(r)
	if peer := hostOnly(r.RemoteAddr); peer != "" {
		hops = append(hops, peer)
	}
	if ip := clientFromHops(hops); ip != "" {
		return ip
	}
	return hostOnly(r.RemoteAddr)
}

func headerHops(r *http.Request) []string {
	var hops []string
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		for _, p := range strings.Split(xff, ",") {
			if h := hostOnly(p); h != "" {
				hops = append(hops, h)
			}
		}
	}
	if xri := hostOnly(r.Header.Get("X-Real-IP")); xri != "" {
		hops = append(hops, xri)
	}
	if tci := hostOnly(r.Header.Get("True-Client-IP")); tci != "" {
		hops = append(hops, tci)
	}
	return hops
}

func clientFromHops(hops []string) string {
	for i := len(hops) - 1; i >= 0; i-- {
		ip := net.ParseIP(hops[i])
		if ip == nil || isTrustedHop(ip) {
			continue
		}
		return hops[i]
	}
	for _, h := range hops {
		if net.ParseIP(h) != nil {
			return h
		}
	}
	return ""
}

func isTrustedHop(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()
}

func hostOnly(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(s); err == nil {
		return host
	}
	return strings.Trim(s, "[]")
}
