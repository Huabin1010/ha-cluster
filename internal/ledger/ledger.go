package ledger

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

type Service struct {
	Store store.Store
}

type ReserveRequest struct {
	ProjectID  uuid.UUID
	Plan       models.Plan
	Arch       string
	RequireK8s bool
}

type ReserveResult struct {
	Allocation models.Allocation
	Node       models.Node
}

type scoredNode struct {
	node  models.Node
	score int64
}

func (s *Service) PickCandidateNodes(ctx context.Context, arch string, cpu, mem, disk int64) ([]models.Node, error) {
	return s.pickCandidates(ctx, arch, cpu, mem, disk, false)
}

type ProbeResult struct {
	Available bool
	Fits      int
	Nodes     int
	Reason    string
}

func countFits(nodes []models.Node, cpu, mem, disk int64) int {
	if cpu <= 0 || mem <= 0 || disk <= 0 {
		return 0
	}
	total := 0
	for _, n := range nodes {
		freeCPU := n.AllocatableCPU - n.UsedCPU
		freeMem := n.AllocatableMem - n.UsedMem
		freeDisk := n.AllocatableDisk - n.UsedDisk
		nCPU := freeCPU / cpu
		nMem := freeMem / mem
		nDisk := freeDisk / disk
		nFit := nCPU
		if nMem < nFit {
			nFit = nMem
		}
		if nDisk < nFit {
			nFit = nDisk
		}
		if nFit > 0 {
			total += int(nFit)
		}
	}
	return total
}

func wrapReason(err error) string {
	return store.Reason(err, store.ErrNoCapacity)
}

func noCapacityReason(requireK8s, sawArch, sawReady, sawK8s bool) error {
	if !sawArch {
		return store.Wrap(store.ErrNoCapacity, "没有该架构的 worker")
	}
	if !sawReady {
		return store.Wrap(store.ErrNoCapacity, "该架构节点当前未就绪")
	}
	if requireK8s && !sawK8s {
		return store.Wrap(store.ErrNoCapacity, "没有带 k3s/k8s 标签且就绪的该架构 worker")
	}
	if requireK8s {
		return store.Wrap(store.ErrNoCapacity, "带 Kubernetes 标签的节点空闲容量不够放下此套餐")
	}
	return store.Wrap(store.ErrNoCapacity, "该架构节点空闲容量不够放下此套餐")
}

func (s *Service) Probe(ctx context.Context, arch string, cpu, mem, disk int64, requireK8s bool) (ProbeResult, error) {
	candidates, err := s.pickCandidates(ctx, arch, cpu, mem, disk, requireK8s)
	if err != nil {
		if errors.Is(err, store.ErrNoCapacity) {
			return ProbeResult{Reason: wrapReason(err)}, nil
		}
		return ProbeResult{}, err
	}
	fits := countFits(candidates, cpu, mem, disk)
	return ProbeResult{Available: fits > 0, Fits: fits, Nodes: len(candidates)}, nil
}

func (s *Service) pickCandidates(ctx context.Context, arch string, cpu, mem, disk int64, requireK8s bool) ([]models.Node, error) {
	nodes, err := s.Store.ListNodes(ctx)
	if err != nil {
		return nil, err
	}
	var scored []scoredNode
	sawArch, sawReady, sawK8s := false, false, false
	for i := range nodes {
		n := nodes[i]
		if n.Role == "control-plane" {
			continue
		}
		if arch != models.ArchAny && n.Arch != arch {
			continue
		}
		sawArch = true
		if !n.Ready {
			continue
		}
		sawReady = true
		if requireK8s && !models.NodeSupportsK8s(n.Tags) {
			continue
		}
		if requireK8s {
			sawK8s = true
		}
		freeCPU := n.AllocatableCPU - n.UsedCPU
		freeMem := n.AllocatableMem - n.UsedMem
		freeDisk := n.AllocatableDisk - n.UsedDisk
		if freeCPU < cpu || freeMem < mem || freeDisk < disk {
			continue
		}
		score := freeMem
		if n.Power == "mains" {
			score += 1 << 40
		}
		if n.FabricPath == "p2p" {
			score += 1 << 30
		}
		scored = append(scored, scoredNode{node: n, score: score})
	}
	if len(scored) == 0 {
		return nil, noCapacityReason(requireK8s, sawArch, sawReady, sawK8s)
	}
	sort.Slice(scored, func(i, j int) bool {
		return scored[i].score > scored[j].score
	})
	out := make([]models.Node, len(scored))
	for i := range scored {
		out[i] = scored[i].node
	}
	return out, nil
}

func (s *Service) PickNode(ctx context.Context, arch string, cpu, mem, disk int64) (*models.Node, error) {
	candidates, err := s.pickCandidates(ctx, arch, cpu, mem, disk, false)
	if err != nil {
		return nil, err
	}
	return &candidates[0], nil
}

func (s *Service) Reserve(ctx context.Context, req ReserveRequest) (*ReserveResult, error) {
	arch := req.Arch
	if arch == "" {
		arch = models.ArchAny
	}
	a := models.Allocation{
		ID:        uuid.New(),
		ProjectID: req.ProjectID,
		CPUMilli:  req.Plan.CPUMilli,
		MemBytes:  req.Plan.MemBytes,
		DiskBytes: req.Plan.DiskBytes,
		Arch:      arch,
		State:     models.AllocReserved,
		CreatedAt: time.Now(),
	}
	if !req.RequireK8s {
		if err := s.Store.ReserveBestNode(ctx, arch, req.Plan.CPUMilli, req.Plan.MemBytes, req.Plan.DiskBytes, &a); err == nil {
			n2, err := s.Store.GetNode(ctx, a.NodeID)
			if err != nil {
				return nil, err
			}
			if a.Arch == models.ArchAny || a.Arch == "" {
				a.Arch = n2.Arch
			}
			return &ReserveResult{Allocation: a, Node: *n2}, nil
		} else if !errors.Is(err, store.ErrNoCapacity) {
			return nil, err
		}
	}

	candidates, err := s.pickCandidates(ctx, arch, req.Plan.CPUMilli, req.Plan.MemBytes, req.Plan.DiskBytes, req.RequireK8s)
	if err != nil {
		return nil, err
	}

	var lastErr error
	for _, node := range candidates {
		boundArch := node.Arch
		try := models.Allocation{
			ID:        uuid.New(),
			ProjectID: req.ProjectID,
			CPUMilli:  req.Plan.CPUMilli,
			MemBytes:  req.Plan.MemBytes,
			DiskBytes: req.Plan.DiskBytes,
			Arch:      boundArch,
			State:     models.AllocReserved,
			CreatedAt: time.Now(),
		}
		if err := s.Store.ReserveOnNode(ctx, node.ID, &try); err != nil {
			if errors.Is(err, store.ErrNoCapacity) {
				lastErr = err
				continue
			}
			return nil, err
		}
		n2, err := s.Store.GetNode(ctx, node.ID)
		if err != nil {
			return nil, err
		}
		return &ReserveResult{Allocation: try, Node: *n2}, nil
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, store.ErrNoCapacity
}

func (s *Service) Release(ctx context.Context, id uuid.UUID) error {
	return s.Store.ReleaseAllocation(ctx, id)
}

func (s *Service) Expand(ctx context.Context, id uuid.UUID, dCPU, dMem, dDisk int64) error {
	return s.Store.ExpandAllocation(ctx, id, dCPU, dMem, dDisk)
}

// Shrink releases capacity back to the node (negative delta via ExpandAllocation).
func (s *Service) Shrink(ctx context.Context, id uuid.UUID, dCPU, dMem, dDisk int64) error {
	if dCPU < 0 || dMem < 0 || dDisk < 0 {
		return store.ErrInvalidInput
	}
	return s.Store.ExpandAllocation(ctx, id, -dCPU, -dMem, -dDisk)
}

func RemainingError(node models.Node, plan models.Plan) error {
	return fmt.Errorf("%w: remaining cpu=%d mem=%d disk=%d requested cpu=%d mem=%d disk=%d",
		store.ErrNoCapacity,
		node.AllocatableCPU-node.UsedCPU,
		node.AllocatableMem-node.UsedMem,
		node.AllocatableDisk-node.UsedDisk,
		plan.CPUMilli, plan.MemBytes, plan.DiskBytes,
	)
}
