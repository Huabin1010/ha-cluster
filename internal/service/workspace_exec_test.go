package service

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
)

func TestShouldProbeExec(t *testing.T) {
	running := models.Workspace{Status: models.WSRunning, SSHPort: 22001, NodeID: uuid.New()}
	if !shouldProbeExec(running) {
		t.Fatal("never-checked running should probe")
	}
	k8s := running
	k8s.Runtime = models.RuntimeK8s
	if shouldProbeExec(k8s) {
		t.Fatal("k8s should not probe")
	}
	stopped := running
	stopped.Status = models.WSStopped
	if shouldProbeExec(stopped) {
		t.Fatal("stopped should not probe")
	}
	fresh := running
	fresh.ExecCheckedAt = time.Now()
	if shouldProbeExec(fresh) {
		t.Fatal("fresh check should skip")
	}
	stale := running
	stale.ExecCheckedAt = time.Now().Add(-time.Minute)
	if !shouldProbeExec(stale) {
		t.Fatal("stale check should probe")
	}
}
