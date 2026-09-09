package memory

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

func TestReleaseIdempotent(t *testing.T) {
	s := New()
	n := models.Node{ID: uuid.New(), Name: "n", Arch: "amd64", Role: "worker", AllocatableCPU: 1000, AllocatableMem: 1000, AllocatableDisk: 1000, Ready: true}
	_ = s.UpsertNode(context.Background(), &n)
	a := models.Allocation{ID: uuid.New(), CPUMilli: 100, MemBytes: 100, DiskBytes: 100}
	if err := s.ReserveOnNode(context.Background(), n.ID, &a); err != nil {
		t.Fatal(err)
	}
	if err := s.ReleaseAllocation(context.Background(), a.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.ReleaseAllocation(context.Background(), a.ID); err != nil {
		t.Fatal(err)
	}
	got, _ := s.GetNode(context.Background(), n.ID)
	if got.UsedCPU != 0 {
		t.Fatalf("%+v", got)
	}
}

func TestDuplicateUser(t *testing.T) {
	s := New()
	u := &models.User{ID: uuid.New(), Username: "a", Email: "a@x.com"}
	if err := s.CreateUser(context.Background(), u); err != nil {
		t.Fatal(err)
	}
	u2 := &models.User{ID: uuid.New(), Username: "a", Email: "b@x.com"}
	if err := s.CreateUser(context.Background(), u2); err != store.ErrConflict {
		t.Fatal(err)
	}
}

func TestUpsertNodePreservesUsedCapacity(t *testing.T) {
	ctx := context.Background()
	s := New()
	n := models.Node{
		ID: uuid.New(), Name: "node-worker-1", Arch: "amd64", Role: "worker",
		AllocatableCPU: 4000, AllocatableMem: 8000, AllocatableDisk: 10000, Ready: true,
	}
	if err := s.UpsertNode(ctx, &n); err != nil {
		t.Fatal(err)
	}

	alloc := models.Allocation{
		ID: uuid.New(), ProjectID: uuid.New(),
		CPUMilli: 1000, MemBytes: 2000, DiskBytes: 3000,
	}
	if err := s.ReserveOnNode(ctx, n.ID, &alloc); err != nil {
		t.Fatal(err)
	}

	// Verify capacity reserved
	nodeBefore, err := s.GetNode(ctx, n.ID)
	if err != nil || nodeBefore.UsedCPU != 1000 || nodeBefore.UsedMem != 2000 {
		t.Fatalf("expected node used 1000/2000, got %+v, err=%v", nodeBefore, err)
	}

	// Simulate heartbeat arriving with same name and same ID, used capacity fields 0
	heartbeatNode := models.Node{
		ID: n.ID, Name: "node-worker-1", Arch: "amd64", Role: "worker",
		AllocatableCPU: 4000, AllocatableMem: 8000, AllocatableDisk: 10000,
		UsedCPU: 0, UsedMem: 0, UsedDisk: 0, Ready: true,
	}
	if err := s.UpsertNode(ctx, &heartbeatNode); err != nil {
		t.Fatal(err)
	}

	nodeAfter, err := s.GetNode(ctx, n.ID)
	if err != nil {
		t.Fatal(err)
	}
	if nodeAfter.UsedCPU != 1000 || nodeAfter.UsedMem != 2000 || nodeAfter.UsedDisk != 3000 {
		t.Fatalf("heartbeat wiped used capacity! got used cpu=%d mem=%d disk=%d",
			nodeAfter.UsedCPU, nodeAfter.UsedMem, nodeAfter.UsedDisk)
	}
}

func TestSnapshotSaveAndLoad(t *testing.T) {
	ctx := context.Background()
	snapFile := t.TempDir() + "/snap.json"

	s1 := New()
	s1.SetSnapshotPath(snapFile)
	uid := uuid.New()
	u := &models.User{
		ID: uid, Username: "bob", Email: "bob@example.com",
		PasswordHash: "argon2id$keep-me", TokenVersion: 3,
	}
	if err := s1.CreateUser(ctx, u); err != nil {
		t.Fatal(err)
	}

	pid := uuid.New()
	p := &models.Project{ID: pid, Name: "TestProj", Slug: "test-proj", OwnerID: uid}
	if err := s1.CreateProject(ctx, p, "owner"); err != nil {
		t.Fatal(err)
	}

	// Load into a new store
	s2 := New()
	if err := s2.LoadSnapshot(snapFile); err != nil {
		t.Fatalf("load snapshot failed: %v", err)
	}

	uGot, err := s2.GetUserByID(ctx, uid)
	if err != nil || uGot.Username != "bob" {
		t.Fatalf("user not restored: %+v, err=%v", uGot, err)
	}
	if uGot.PasswordHash != "argon2id$keep-me" || uGot.TokenVersion != 3 {
		t.Fatalf("credentials not restored: hash=%q tv=%d", uGot.PasswordHash, uGot.TokenVersion)
	}

	pGot, err := s2.GetProject(ctx, pid)
	if err != nil || pGot.Slug != "test-proj" {
		t.Fatalf("project not restored: %+v, err=%v", pGot, err)
	}
}


