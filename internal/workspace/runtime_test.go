package workspace

import (
	"testing"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
)

func TestMemoryRuntimeLifecycle(t *testing.T) {
	rt := NewMemoryRuntime()
	w := models.Workspace{ID: uuid.New()}
	n := models.Node{ID: uuid.New()}
	inst, err := rt.Launch(t.Context(), w, n, nil)
	if err != nil {
		t.Fatal(err)
	}
	if inst.SSHPort == 0 || !inst.Running {
		t.Fatalf("%+v", inst)
	}
	if err := rt.Stop(t.Context(), w.ID); err != nil {
		t.Fatal(err)
	}
	got, ok := rt.Get(t.Context(), w.ID)
	if !ok || got.Running {
		t.Fatal("should be stopped")
	}
	_ = rt.Start(t.Context(), w.ID)
	got, _ = rt.Get(t.Context(), w.ID)
	if !got.Running {
		t.Fatal("should run")
	}
	_ = rt.Destroy(t.Context(), w.ID)
	if _, ok := rt.Get(t.Context(), w.ID); ok {
		t.Fatal("destroyed")
	}
}
