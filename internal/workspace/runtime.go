package workspace

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
)

type Instance struct {
	ID        uuid.UUID
	NodeID    uuid.UUID
	SSHPort   int
	HostKeyFP string
	Running   bool
}

type Runtime interface {
	Launch(ctx context.Context, w models.Workspace, node models.Node, sshKeys []string) (Instance, error)
	Stop(ctx context.Context, id uuid.UUID) error
	Start(ctx context.Context, id uuid.UUID) error
	Destroy(ctx context.Context, id uuid.UUID) error
	Get(ctx context.Context, id uuid.UUID) (Instance, bool)
}

type MemoryRuntime struct {
	mu      sync.Mutex
	nextPort int
	inst    map[uuid.UUID]Instance
}

func NewMemoryRuntime() *MemoryRuntime {
	return &MemoryRuntime{nextPort: 22000, inst: map[uuid.UUID]Instance{}}
}

func (r *MemoryRuntime) Launch(_ context.Context, w models.Workspace, node models.Node, _ []string) (Instance, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.nextPort++
	sum := sha256.Sum256([]byte(w.ID.String() + node.ID.String()))
	inst := Instance{
		ID:        w.ID,
		NodeID:    node.ID,
		SSHPort:   r.nextPort,
		HostKeyFP: "SHA256:" + hex.EncodeToString(sum[:8]),
		Running:   true,
	}
	r.inst[w.ID] = inst
	return inst, nil
}

func (r *MemoryRuntime) Stop(_ context.Context, id uuid.UUID) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	inst, ok := r.inst[id]
	if !ok {
		return fmt.Errorf("not found")
	}
	inst.Running = false
	r.inst[id] = inst
	return nil
}

func (r *MemoryRuntime) Start(_ context.Context, id uuid.UUID) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	inst, ok := r.inst[id]
	if !ok {
		return fmt.Errorf("not found")
	}
	inst.Running = true
	r.inst[id] = inst
	return nil
}

func (r *MemoryRuntime) Destroy(_ context.Context, id uuid.UUID) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.inst, id)
	return nil
}

func (r *MemoryRuntime) Get(_ context.Context, id uuid.UUID) (Instance, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	inst, ok := r.inst[id]
	return inst, ok
}

func FailLaunchOnce() Runtime { return &failOnce{inner: NewMemoryRuntime()} }

type failOnce struct {
	inner *MemoryRuntime
	failed bool
}

func (f *failOnce) Launch(ctx context.Context, w models.Workspace, node models.Node, keys []string) (Instance, error) {
	if !f.failed {
		f.failed = true
		return Instance{}, fmt.Errorf("incus launch failed")
	}
	return f.inner.Launch(ctx, w, node, keys)
}
func (f *failOnce) Stop(ctx context.Context, id uuid.UUID) error    { return f.inner.Stop(ctx, id) }
func (f *failOnce) Start(ctx context.Context, id uuid.UUID) error   { return f.inner.Start(ctx, id) }
func (f *failOnce) Destroy(ctx context.Context, id uuid.UUID) error { return f.inner.Destroy(ctx, id) }
func (f *failOnce) Get(ctx context.Context, id uuid.UUID) (Instance, bool) {
	return f.inner.Get(ctx, id)
}

func Sleep(_ time.Duration) {}
