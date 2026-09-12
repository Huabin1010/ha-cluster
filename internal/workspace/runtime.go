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
	Resize(ctx context.Context, w models.Workspace) error
	Get(ctx context.Context, id uuid.UUID) (Instance, bool)
	ExposePort(ctx context.Context, wsID, routeID uuid.UUID, containerPort int) (int, error)
	UnexposePort(ctx context.Context, wsID, routeID uuid.UUID) error
	SyncKeys(ctx context.Context, id uuid.UUID, keys []string) error
}

type MemoryRuntime struct {
	mu       sync.Mutex
	nextPort int
	inst     map[uuid.UUID]Instance
	keys     map[uuid.UUID][]string
}

func NewMemoryRuntime() *MemoryRuntime {
	return &MemoryRuntime{
		nextPort: 22000,
		inst:     map[uuid.UUID]Instance{},
		keys:     map[uuid.UUID][]string{},
	}
}

func (r *MemoryRuntime) Launch(_ context.Context, w models.Workspace, node models.Node, sshKeys []string) (Instance, error) {
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
	r.keys[w.ID] = append([]string(nil), sshKeys...)
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
	delete(r.keys, id)
	return nil
}

func (r *MemoryRuntime) Resize(_ context.Context, w models.Workspace) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.inst[w.ID]; !ok {
		return fmt.Errorf("not found")
	}
	return nil
}

func (r *MemoryRuntime) Get(_ context.Context, id uuid.UUID) (Instance, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	inst, ok := r.inst[id]
	return inst, ok
}

func (r *MemoryRuntime) ExposePort(_ context.Context, _, _ uuid.UUID, containerPort int) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.nextPort++
	return r.nextPort, nil
}

func (r *MemoryRuntime) UnexposePort(_ context.Context, _, _ uuid.UUID) error {
	return nil
}

func (r *MemoryRuntime) SyncKeys(_ context.Context, id uuid.UUID, keys []string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.inst[id]; !ok {
		return fmt.Errorf("not found")
	}
	r.keys[id] = append([]string(nil), keys...)
	return nil
}

func (r *MemoryRuntime) GetKeys(id uuid.UUID) []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.keys[id]...)
}

func FailLaunchOnce() Runtime { return &failOnce{inner: NewMemoryRuntime()} }

// BlockableRuntime holds Launch until Release is closed. It ignores context
// cancel so tests can simulate Incus finishing after the user already destroyed
// the workspace.
func NewBlockableRuntime() *BlockableRuntime {
	return &BlockableRuntime{
		MemoryRuntime: NewMemoryRuntime(),
		Started:       make(chan struct{}),
		Release:       make(chan struct{}),
	}
}

type BlockableRuntime struct {
	*MemoryRuntime
	Started   chan struct{}
	Release   chan struct{}
	FailAfter bool
}

func (b *BlockableRuntime) Launch(ctx context.Context, w models.Workspace, node models.Node, keys []string) (Instance, error) {
	select {
	case <-b.Started:
	default:
		close(b.Started)
	}
	<-b.Release
	if b.FailAfter {
		return Instance{}, fmt.Errorf("incus launch failed")
	}
	return b.MemoryRuntime.Launch(ctx, w, node, keys)
}

type failOnce struct {
	inner  *MemoryRuntime
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
func (f *failOnce) Resize(ctx context.Context, w models.Workspace) error {
	return f.inner.Resize(ctx, w)
}
func (f *failOnce) Get(ctx context.Context, id uuid.UUID) (Instance, bool) {
	return f.inner.Get(ctx, id)
}
func (f *failOnce) ExposePort(ctx context.Context, wsID, routeID uuid.UUID, containerPort int) (int, error) {
	return f.inner.ExposePort(ctx, wsID, routeID, containerPort)
}
func (f *failOnce) UnexposePort(ctx context.Context, wsID, routeID uuid.UUID) error {
	return f.inner.UnexposePort(ctx, wsID, routeID)
}
func (f *failOnce) SyncKeys(ctx context.Context, id uuid.UUID, keys []string) error {
	return f.inner.SyncKeys(ctx, id, keys)
}

func Sleep(_ time.Duration) {}
