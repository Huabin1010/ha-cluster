package agent

import "testing"

func TestHostCapacity(t *testing.T) {
	cpu, mem := HostCapacity()
	if cpu <= 0 {
		t.Fatalf("cpu %d", cpu)
	}
	if mem <= 0 {
		t.Skip("no /proc/meminfo")
	}
}
