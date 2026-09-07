package workspace

import (
	"context"
	"fmt"
	"net"
	"testing"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
)

func TestAllocateHostPort(t *testing.T) {
	port, err := allocateHostPort(32100, 32110)
	if err != nil {
		t.Fatalf("allocateHostPort failed: %v", err)
	}
	if port < 32100 || port > 32110 {
		t.Fatalf("port %d out of range [32100, 32110]", port)
	}

	// Occupy the port, next allocation should pick another
	l, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", port))
	if err != nil {
		t.Fatalf("failed to listen on port %d: %v", port, err)
	}
	defer l.Close()

	nextPort, err := allocateHostPort(32100, 32110)
	if err != nil {
		t.Fatalf("second allocateHostPort failed: %v", err)
	}
	if nextPort == port {
		t.Fatalf("expected different port from %d, got %d", port, nextPort)
	}
}

func TestIncusRuntimeLifecycle(t *testing.T) {
	if !Available() {
		t.Skip("incus not available on this host")
	}
	rt := NewIncusRuntime()
	rt.Image = "ha-ubuntu-24.04"

	w := models.Workspace{
		ID:   uuid.New(),
		Plan: "nano",
	}
	n := models.Node{
		ID:   uuid.New(),
		Name: "dev-pc",
	}
	testKey := "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAII0testkeytestkeytestkeytestkeytestkeytestkey e2e@test"

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	defer func() {
		_ = rt.Destroy(context.Background(), w.ID)
	}()

	inst, err := rt.Launch(ctx, w, n, []string{testKey})
	if err != nil {
		t.Fatalf("Launch failed: %v", err)
	}
	if !inst.Running {
		t.Fatalf("expected running, got %+v", inst)
	}
	if inst.SSHPort < 22001 || inst.SSHPort > 23999 {
		t.Fatalf("expected host SSHPort in 22001-23999, got %d", inst.SSHPort)
	}

	got, ok := rt.Get(ctx, w.ID)
	if !ok || !got.Running {
		t.Fatalf("Get returned ok=%v, running=%v", ok, got.Running)
	}
	if got.SSHPort != inst.SSHPort {
		t.Fatalf("Get returned SSHPort=%d, want %d", got.SSHPort, inst.SSHPort)
	}

	// Test ExposePort and UnexposePort
	routeID := uuid.New()
	hp, err := rt.ExposePort(ctx, w.ID, routeID, 8080)
	if err != nil {
		t.Fatalf("ExposePort failed: %v", err)
	}
	if hp <= 0 {
		t.Fatalf("expected positive host port, got %d", hp)
	}
	if err := rt.UnexposePort(ctx, w.ID, routeID); err != nil {
		t.Fatalf("UnexposePort failed: %v", err)
	}

	// Test SyncKeys
	newKey := "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ2newsynckeynewsynckeynewsynckeynewsynckey e2e@test2"
	if err := rt.SyncKeys(ctx, w.ID, []string{testKey, newKey}); err != nil {
		t.Fatalf("SyncKeys failed: %v", err)
	}

	if err := rt.Stop(ctx, w.ID); err != nil {
		t.Fatalf("Stop failed: %v", err)
	}

	got, ok = rt.Get(ctx, w.ID)
	if !ok || got.Running {
		t.Fatalf("expected stopped, got ok=%v, running=%v", ok, got.Running)
	}

	if err := rt.Start(ctx, w.ID); err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	got, ok = rt.Get(ctx, w.ID)
	if !ok || !got.Running {
		t.Fatalf("expected restarted running, got ok=%v, running=%v", ok, got.Running)
	}

	if err := rt.Destroy(ctx, w.ID); err != nil {
		t.Fatalf("Destroy failed: %v", err)
	}

	if _, ok := rt.Get(ctx, w.ID); ok {
		t.Fatalf("expected destroyed instance to not be found")
	}
}
