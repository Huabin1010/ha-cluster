package webshell

import (
	"fmt"
	"os"
	"strings"
)

func IsFake(rt any) bool {
	if v := strings.TrimSpace(os.Getenv("HA_WEB_TERMINAL_FAKE")); v == "1" || strings.EqualFold(v, "true") {
		return true
	}
	if rt == nil {
		return true
	}
	name := fmt.Sprintf("%T", rt)
	return strings.Contains(name, "MemoryRuntime") && !strings.Contains(name, "Remote")
}
