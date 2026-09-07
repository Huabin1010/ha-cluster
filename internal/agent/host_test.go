package agent

import (
	"os"
	"testing"
)

func TestHostCapacity(t *testing.T) {
	cpu, mem := HostCapacity()
	if cpu <= 0 {
		t.Fatalf("cpu %d", cpu)
	}
	if mem <= 0 {
		t.Skip("no /proc/meminfo")
	}
}

func TestHostDiskCapacity(t *testing.T) {
	total, alloc := HostDiskCapacity("/")
	if total <= 0 {
		t.Fatalf("total disk bytes %d <= 0", total)
	}
	t.Logf("root disk: total=%d, allocatable=%d", total, alloc)

	// Test non-existent path fallback to 0
	_, badAlloc := HostDiskCapacity("/non/existent/path/for/test/xyz")
	if badAlloc != 0 {
		t.Fatalf("expected 0 for bad path, got %d", badAlloc)
	}

	// Test with HA_STORAGE_PATH env
	_ = os.Setenv("HA_STORAGE_PATH", "/")
	defer os.Unsetenv("HA_STORAGE_PATH")
	_, envAlloc := HostDiskCapacity("")
	if envAlloc != alloc {
		t.Fatalf("expected %d, got %d", alloc, envAlloc)
	}
}
