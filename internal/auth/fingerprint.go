package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"net"
	"net/http"
	"strings"
)

// DeviceFingerprint binds a refresh token to a coarse client identity.
func DeviceFingerprint(r *http.Request) string {
	ua := strings.TrimSpace(r.Header.Get("User-Agent"))
	ip := clientIP(r)
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

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return strings.TrimSpace(xri)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
