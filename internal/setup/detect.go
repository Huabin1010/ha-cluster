package setup

import (
	"runtime"
	"strings"
)

type Detected struct {
	GOARCH string
	OS     string
}

func Detect() Detected {
	return Detected{GOARCH: runtime.GOARCH, OS: runtime.GOOS}
}

func PayloadName(arch string) string {
	switch arch {
	case "amd64", "x86_64":
		return "ha-payload-linux-amd64.tar.zst"
	case "arm64", "aarch64":
		return "ha-payload-linux-arm64.tar.zst"
	default:
		return ""
	}
}

func ArchMismatch(payloadArch, machineArch string) bool {
	norm := func(s string) string {
		s = strings.ToLower(s)
		if s == "x86_64" {
			return "amd64"
		}
		if s == "aarch64" {
			return "arm64"
		}
		return s
	}
	p, m := norm(payloadArch), norm(machineArch)
	if p == "" || m == "" {
		return true
	}
	return p != m
}

func RejectServerOnBattery(role, power string) bool {
	return role == "server" && power == "battery"
}

func JoinTokenValid(token string) bool {
	return strings.HasPrefix(token, "ha://join/") && strings.Contains(token, "et_net=")
}
