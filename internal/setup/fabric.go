package setup

import (
	"fmt"
	"net"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// pingFabricIP is swapped in tests. Returns true if the address answers.
var pingFabricIP = pingIPv4Once

// NormalizeStaticIPv4 rejects EasyTier DHCP / empty and returns a dotted IPv4.
func NormalizeStaticIPv4(raw string) (string, error) {
	s := strings.TrimSpace(strings.ToLower(raw))
	if s == "" || s == "dhcp" || s == "auto" {
		return "", fmt.Errorf("fabric IP must be static (got %q); EasyTier DHCP is unstable", raw)
	}
	s = strings.TrimSuffix(strings.TrimSpace(raw), "/24")
	ip := net.ParseIP(s)
	if ip == nil || ip.To4() == nil {
		return "", fmt.Errorf("invalid static fabric IP %q", raw)
	}
	return ip.To4().String(), nil
}

// CheckFabricIPConflict probes the candidate before easytier-core starts.
// A reply means another peer already holds the address.
func CheckFabricIPConflict(ip string) error {
	norm, err := NormalizeStaticIPv4(ip)
	if err != nil {
		return err
	}
	if pingFabricIP(norm) {
		return fmt.Errorf("fabric IP %s already answers ping (address conflict)", norm)
	}
	return nil
}

func pingIPv4Once(ip string) bool {
	args := []string{"-c", "1", "-W", "1", ip}
	if runtime.GOOS == "windows" {
		args = []string{"-n", "1", "-w", "800", ip}
	}
	cmd := exec.Command("ping", args...)
	done := make(chan error, 1)
	go func() { done <- cmd.Run() }()
	select {
	case err := <-done:
		return err == nil
	case <-time.After(2 * time.Second):
		_ = cmd.Process.Kill()
		return false
	}
}
