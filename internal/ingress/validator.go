package ingress

import (
	"regexp"
	"strings"
)

var ReservedSubdomains = map[string]struct{}{
	"admin": {}, "api": {}, "auth": {}, "bastion": {}, "console": {},
	"control": {}, "dashboard": {}, "depot": {}, "dns": {}, "docs": {},
	"gateway": {}, "git": {}, "grafana": {}, "health": {}, "login": {},
	"logout": {}, "mail": {}, "monitor": {}, "ops": {}, "prometheus": {},
	"proxy": {}, "register": {}, "root": {}, "signup": {}, "status": {},
	"system": {}, "vpn": {}, "web": {}, "ws": {},
}

func IsSubdomainReserved(domain string) bool {
	domain = strings.ToLower(strings.TrimSpace(domain))
	parts := strings.Split(domain, ".")
	if len(parts) > 0 {
		sub := parts[0]
		if _, ok := ReservedSubdomains[sub]; ok {
			return true
		}
	}
	return false
}

var prefixRE = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)

// ValidPrefix validates a single DNS label used under a platform zone suffix.
func ValidPrefix(p string) bool {
	p = strings.ToLower(strings.TrimSpace(p))
	if p == "" || len(p) > 63 || strings.Contains(p, ".") {
		return false
	}
	return prefixRE.MatchString(p)
}

func IsPrefixReserved(prefix string) bool {
	_, ok := ReservedSubdomains[strings.ToLower(strings.TrimSpace(prefix))]
	return ok
}

// NormalizeSuffix strips leading "*." and lowercases a zone suffix.
func NormalizeSuffix(suffix string) string {
	s := strings.ToLower(strings.TrimSpace(suffix))
	s = strings.TrimPrefix(s, "*.")
	return strings.TrimPrefix(s, ".")
}
