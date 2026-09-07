package workspace

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
)

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

	got, ok := rt.Get(ctx, w.ID)
	if !ok || !got.Running {
		t.Fatalf("Get returned ok=%v, running=%v", ok, got.Running)
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
