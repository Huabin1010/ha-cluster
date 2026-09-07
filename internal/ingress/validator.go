package ingress

import "strings"

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
