package ledger

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
	"ha-cluster/internal/store/memory"
)

func seedNode(t *testing.T, st *memory.Store, arch string, cpu, mem, disk int64) models.Node {
	t.Helper()
	n := models.Node{
		ID:              uuid.New(),
		Name:            "n-" + uuid.NewString()[:8],
		Arch:            arch,
		Class:           "server",
		Power:           "mains",
		Role:            "worker",
		AllocatableCPU:  cpu,
		AllocatableMem:  mem,
		AllocatableDisk: disk,
		Ready:           true,
		LastHeartbeat:   time.Now(),
	}
	if err := st.UpsertNode(context.Background(), &n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestReserveRejectsOversell(t *testing.T) {
	st := memory.New()
	const Gi = 1024 * 1024 * 1024
	seedNode(t, st, models.ArchAMD64, 4000, 2*Gi, 40*Gi)
	svc := Service{Store: st}
	plan := models.Plans()["large"]
	ctx := context.Background()
	pid := uuid.New()
	if _, err := svc.Reserve(ctx, ReserveRequest{ProjectID: pid, Plan: plan, Arch: models.ArchAMD64}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Reserve(ctx, ReserveRequest{ProjectID: pid, Plan: plan, Arch: models.ArchAMD64}); !errors.Is(err, store.ErrNoCapacity) {
		t.Fatalf("expected no capacity, got %v", err)
	}
}

func TestReserveArchIsolation(t *testing.T) {
	st := memory.New()
	const Gi = 1024 * 1024 * 1024
	seedNode(t, st, models.ArchARM64, 8000, 4*Gi, 40*Gi)
	svc := Service{Store: st}
	plan := models.Plans()["small"]
	_, err := svc.Reserve(context.Background(), ReserveRequest{
		ProjectID: uuid.New(), Plan: plan, Arch: models.ArchAMD64,
	})
	if !errors.Is(err, store.ErrNoCapacity) {
		t.Fatalf("amd64 request must not consume arm64 pool: %v", err)
	}
}

func TestReleaseReturnsCapacity(t *testing.T) {
	st := memory.New()
	const Gi = 1024 * 1024 * 1024
	seedNode(t, st, models.ArchAMD64, 4000, 2*Gi, 40*Gi)
	svc := Service{Store: st}
	plan := models.Plans()["large"]
	ctx := context.Background()
	r, err := svc.Reserve(ctx, ReserveRequest{ProjectID: uuid.New(), Plan: plan, Arch: models.ArchAMD64})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.Release(ctx, r.Allocation.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.Release(ctx, r.Allocation.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Reserve(ctx, ReserveRequest{ProjectID: uuid.New(), Plan: plan, Arch: models.ArchAMD64}); err != nil {
		t.Fatalf("capacity should return after release: %v", err)
	}
}

func TestConcurrentReserveDoesNotOversell(t *testing.T) {
	st := memory.New()
	const Gi = 1024 * 1024 * 1024
	seedNode(t, st, models.ArchAMD64, 4000, 2*Gi, 200*Gi)
	svc := Service{Store: st}
	plan := models.Plans()["large"]
	ctx := context.Background()
	var ok atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := svc.Reserve(ctx, ReserveRequest{ProjectID: uuid.New(), Plan: plan, Arch: models.ArchAMD64}); err == nil {
				ok.Add(1)
			} else if !errors.Is(err, store.ErrNoCapacity) {
				t.Errorf("unexpected %v", err)
			}
		}()
	}
	wg.Wait()
	if ok.Load() != 1 {
		t.Fatalf("want exactly 1 success, got %d", ok.Load())
	}
	nodes, _ := st.ListNodes(ctx)
	if nodes[0].UsedMem != 2*Gi {
		t.Fatalf("used mem = %d", nodes[0].UsedMem)
	}
}

func TestMainsPreferredOverBattery(t *testing.T) {
	st := memory.New()
	const Gi = 1024 * 1024 * 1024
	bat := models.Node{
		ID: uuid.New(), Name: "phone", Arch: models.ArchARM64, Power: "battery",
		Role: "worker", AllocatableCPU: 4000, AllocatableMem: 3 * Gi, AllocatableDisk: 20 * Gi, Ready: true,
	}
	mains := models.Node{
		ID: uuid.New(), Name: "pc", Arch: models.ArchARM64, Power: "mains",
		Role: "worker", AllocatableCPU: 4000, AllocatableMem: 3 * Gi, AllocatableDisk: 20 * Gi, Ready: true,
	}
	_ = st.UpsertNode(context.Background(), &bat)
	_ = st.UpsertNode(context.Background(), &mains)
	svc := Service{Store: st}
	n, err := svc.PickNode(context.Background(), models.ArchARM64, 1000, Gi, Gi)
	if err != nil {
		t.Fatal(err)
	}
	if n.ID != mains.ID {
		t.Fatalf("picked %s want mains", n.Name)
	}
}

func TestControlPlaneNotScheduled(t *testing.T) {
	st := memory.New()
	const Gi = 1024 * 1024 * 1024
	n := models.Node{
		ID: uuid.New(), Name: "vps", Arch: models.ArchAMD64, Role: "control-plane",
		AllocatableCPU: 8000, AllocatableMem: 8 * Gi, AllocatableDisk: 100 * Gi, Ready: true,
	}
	_ = st.UpsertNode(context.Background(), &n)
	svc := Service{Store: st}
	if _, err := svc.PickNode(context.Background(), models.ArchAMD64, 100, 100, 100); !errors.Is(err, store.ErrNoCapacity) {
		t.Fatalf("control-plane must not be picked: %v", err)
	}
}

func TestStoppedKeepsOccupancy(t *testing.T) {
	st := memory.New()
	const Gi = 1024 * 1024 * 1024
	seedNode(t, st, models.ArchAMD64, 4000, 2*Gi, 40*Gi)
	svc := Service{Store: st}
	r, err := svc.Reserve(context.Background(), ReserveRequest{
		ProjectID: uuid.New(), Plan: models.Plans()["large"], Arch: models.ArchAMD64,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.ActivateAllocation(context.Background(), r.Allocation.ID); err != nil {
		t.Fatal(err)
	}
	_, err = svc.Reserve(context.Background(), ReserveRequest{
		ProjectID: uuid.New(), Plan: models.Plans()["large"], Arch: models.ArchAMD64,
	})
	if !errors.Is(err, store.ErrNoCapacity) {
		t.Fatal("active allocation must still occupy")
	}
}
