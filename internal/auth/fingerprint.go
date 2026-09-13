package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"net"
	"net/http"
	"strings"

	"ha-cluster/internal/requestmeta"
)

// DeviceFingerprint binds a refresh token to a coarse client identity.
func DeviceFingerprint(r *http.Request) string {
	ua := strings.TrimSpace(r.Header.Get("User-Agent"))
	ip := requestmeta.FromRequest(r)
	// Use /24 for IPv4 to tolerate mobile network IP rotation within subnet.
	if host, _, err := net.SplitHostPort(ip); err == nil {
		ip = host
	}
	if v4 := net.ParseIP(ip); v4 != nil && v4.To4() != nil {
		parts := strings.Split(ip, ".")
		if len(parts) == 4 {
			ip = parts[0] + "." + parts[1] + "." + parts[2] + ".0"
		}
	}
	sum := sha256.Sum256([]byte(ua + "|" + ip))
	return hex.EncodeToString(sum[:16])
}

