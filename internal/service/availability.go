package service

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"

	hak8s "ha-cluster/internal/k8s"
	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

// WorkspaceAvailability is a dry-run of whether a plan+arch+runtime can be placed.
// It does not reserve capacity.
type WorkspaceAvailability struct {
	Available    bool   `json:"available"`
	ClusterOK    bool   `json:"cluster_ok"`
	BudgetOK     bool   `json:"budget_ok"`
	Fits         int    `json:"fits"`
	Nodes        int    `json:"nodes"`
	Plan         string `json:"plan"`
	Arch         string `json:"arch"`
	Runtime      string `json:"runtime"`
	Reason       string `json:"reason,omitempty"`
	BudgetReason string `json:"budget_reason,omitempty"`
}

func (a *App) WorkspaceAvailability(ctx context.Context, actor models.User, projectID uuid.UUID, planName, arch, runtime string) (*WorkspaceAvailability, error) {
	spec, err := models.ResolveSpec(planName, 0, 0, 0)
	if err != nil {
		return nil, store.Wrap(store.ErrInvalidInput, "未知套餐")
	}
	if strings.TrimSpace(arch) == "" {
		return nil, store.Wrap(store.ErrInvalidInput, "架构须为 amd64 或 arm64")
	}
	archN := normalizeWorkspaceArch(arch)
	if archN == "" || archN == models.ArchAny {
		return nil, store.Wrap(store.ErrInvalidInput, "架构须为 amd64 或 arm64")
	}
	rt := models.NormalizeRuntime(runtime)
	if rt == "" {
		return nil, store.Wrap(store.ErrInvalidInput, "运行环境无效")
	}

	out := &WorkspaceAvailability{
		Plan: spec.Name, Arch: archN, Runtime: rt,
		ClusterOK: true, BudgetOK: true,
	}

	if projectID != uuid.Nil {
		if _, err := a.RequireMembership(ctx, actor, projectID, models.RoleDeveloper); err != nil {
			return nil, err
		}
		if err := a.checkProjectBudget(ctx, projectID, spec); err != nil {
			out.BudgetOK = false
			out.BudgetReason = store.Reason(err, store.ErrNoCapacity)
			if out.BudgetReason == "" {
				out.BudgetReason = "超出项目预算"
			}
		}
	}

	if models.IsK8sRuntime(rt) {
		if err := a.requireLiveK8s(ctx, rt); err != nil {
			out.ClusterOK = false
			out.Available = false
			if errors.Is(err, hak8s.ErrUnavailable) {
				out.Reason = "Kubernetes 控制面暂不可用"
			} else {
				out.Reason = err.Error()
			}
			return out, nil
		}
	}

	probe, err := a.Ledger.Probe(ctx, archN, spec.CPUMilli, spec.MemBytes, spec.DiskBytes, models.IsK8sRuntime(rt))
	if err != nil {
		return nil, err
	}
	out.Fits = probe.Fits
	out.Nodes = probe.Nodes
	out.ClusterOK = probe.Available
	if !probe.Available {
		out.Reason = probe.Reason
		if out.Reason == "" {
			out.Reason = "当前没有可分配的节点"
		}
	}
	out.Available = out.ClusterOK && out.BudgetOK
	return out, nil
}
