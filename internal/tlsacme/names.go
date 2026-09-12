package tlsacme

import (
	"strings"
)

func NormalizeNames(in []string) []string {
	seen := map[string]struct{}{}
	var out []string
	for _, raw := range in {
		n := strings.ToLower(strings.TrimSpace(raw))
		n = strings.TrimSuffix(n, ".")
		if n == "" {
			continue
		}
		if _, ok := seen[n]; ok {
			continue
		}
		seen[n] = struct{}{}
		out = append(out, n)
	}
	return out
}

func WildcardNames(suffix string) []string {
	suf := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(suffix, "*.")))
	suf = strings.TrimSuffix(suf, ".")
	if suf == "" {
		return nil
	}
	return []string{"*." + suf, suf}
}

func ChallengeHost(authzDomain string) string {
	d := strings.ToLower(strings.TrimSpace(authzDomain))
	d = strings.TrimPrefix(d, "*.")
	d = strings.TrimSuffix(d, ".")
	return "_acme-challenge." + d
}

func SplitRecord(fqdn, root string) (domain, sub string) {
	fqdn = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(fqdn), "."))
	root = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(root), "."))
	if root != "" && (fqdn == root || strings.HasSuffix(fqdn, "."+root)) {
		sub = strings.TrimSuffix(fqdn, "."+root)
		if sub == fqdn {
			sub = "@"
		}
		return root, sub
	}
	parts := strings.Split(fqdn, ".")
	if len(parts) < 2 {
		return fqdn, "@"
	}
	domain = strings.Join(parts[len(parts)-2:], ".")
	sub = strings.Join(parts[:len(parts)-2], ".")
	if sub == "" {
		sub = "@"
	}
	return domain, sub
}
