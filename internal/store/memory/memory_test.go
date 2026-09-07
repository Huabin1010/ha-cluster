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
