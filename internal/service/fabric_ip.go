package service

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
)

// Fabric address plan — easytier-fabric.mdc.
const (
	fabricPrefix = "10.129.129."
	fabricHub    = 1
	fabricRelayLo, fabricRelayHi = 2, 9
	fabricProdLo, fabricProdHi   = 10, 204
	fabricLabLo, fabricLabHi     = 205, 252
	fabricControl                = 253
)

// FabricIPPool is the sequential static range used when issuing join tokens.
type FabricIPPool string

const (
	FabricPoolProd FabricIPPool = "prod" // workers 10.129.129.10–.204
	FabricPoolLab  FabricIPPool = "lab"  // PVE / local 10.129.129.205–.252
)

func reservedFabricOctets() map[int]struct{} {
	m := map[int]struct{}{0: {}, fabricHub: {}, fabricControl: {}, 255: {}}
	for i := fabricRelayLo; i <= fabricRelayHi; i++ {
		m[i] = struct{}{}
	}
	return m
}

func parseFabricOctet(ip string) (int, bool) {
	host, _, err := net.SplitHostPort(ip)
	if err == nil {
		ip = host
	}
	ip = strings.TrimSpace(strings.TrimSuffix(ip, "/24"))
	parsed := net.ParseIP(ip)
	if parsed == nil || parsed.To4() == nil {
		return 0, false
	}
	parts := strings.Split(parsed.To4().String(), ".")
	if len(parts) != 4 || strings.Join(parts[:3], ".") != "10.129.129" {
		return 0, false
	}
	n, err := strconv.Atoi(parts[3])
	if err != nil {
		return 0, false
	}
	return n, true
}

// NormalizeStaticFabricIP rejects DHCP / empty and returns dotted IPv4 (no CIDR).
func NormalizeStaticFabricIP(raw string) (string, error) {
	s := strings.TrimSpace(strings.ToLower(raw))
	if s == "" || s == "dhcp" || s == "auto" {
		return "", fmt.Errorf("fabric IP must be static (got %q); EasyTier DHCP is unstable", raw)
	}
	n, ok := parseFabricOctet(raw)
	if !ok {
		return "", fmt.Errorf("fabric IP must be 10.129.129.x, got %q", raw)
	}
	if _, reserved := reservedFabricOctets()[n]; reserved {
		return "", fmt.Errorf("fabric IP 10.129.129.%d is reserved (hub/relay/control)", n)
	}
	return fabricPrefix + strconv.Itoa(n), nil
}

func chooseFabricPool(useLAN bool, apiURL string) FabricIPPool {
	if v := strings.TrimSpace(os.Getenv("HA_FABRIC_POOL")); v != "" {
		switch strings.ToLower(v) {
		case "lab", "local", "pve":
			return FabricPoolLab
		case "prod", "online", "worker":
			return FabricPoolProd
		}
	}
	if useLAN || isPrivateHost(apiHost(apiURL)) {
		return FabricPoolLab
	}
	return FabricPoolProd
}

func poolBounds(p FabricIPPool) (int, int) {
	if p == FabricPoolLab {
		return fabricLabLo, fabricLabHi
	}
	return fabricProdLo, fabricProdHi
}

func usedOctets(used []string) map[int]struct{} {
	out := reservedFabricOctets()
	for _, u := range used {
		if n, ok := parseFabricOctet(u); ok {
			out[n] = struct{}{}
		}
	}
	return out
}

// NextStaticFabricIP returns the lowest free static address in the pool.
func NextStaticFabricIP(used []string, pool FabricIPPool) (string, error) {
	lo, hi := poolBounds(pool)
	taken := usedOctets(used)
	for n := lo; n <= hi; n++ {
		if _, ok := taken[n]; !ok {
			return fabricPrefix + strconv.Itoa(n), nil
		}
	}
	return "", fmt.Errorf("no free static fabric IP in %s pool %s%d–%d", pool, fabricPrefix, lo, hi)
}

// FabricIPConflict reports whether ip is already used or reserved.
func FabricIPConflict(ip string, used []string) error {
	norm, err := NormalizeStaticFabricIP(ip)
	if err != nil {
		return err
	}
	n, _ := parseFabricOctet(norm)
	if _, ok := usedOctets(used)[n]; ok {
		return fmt.Errorf("fabric IP %s is already in use", norm)
	}
	return nil
}
