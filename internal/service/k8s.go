package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	hak8s "ha-cluster/internal/k8s"
	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

func k8sWorkspaceReady(status string) bool {
	switch status {
	case models.WSRunning, models.WSDegraded:
		return true
	default:
		return false
	}
}

func (a *App) requireLiveK8s(ctx context.Context, runtime string) error {
	if !models.IsK8sRuntime(runtime) {
		return nil
	}
	if a.K8s == nil {
		return hak8s.ErrUnavailable
	}
	return a.K8s.Available(ctx)
}

func (a *App) k8sWorkspace(ctx context.Context, actor models.User, id uuid.UUID, minRole string) (*models.Workspace, *models.Membership, error) {
	w, err := a.Store.GetWorkspace(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	mem, err := a.RequireProjectReady(ctx, actor, w.ProjectID, minRole)
	if err != nil {
		return nil, nil, err
	}
	if !models.IsK8sRuntime(w.Runtime) {
		return nil, nil, store.ErrInvalidInput
	}
	return w, mem, nil
}

func (a *App) ApplyK8sYAML(ctx context.Context, actor models.User, id uuid.UUID, yamlText string) ([]map[string]string, error) {
	w, mem, err := a.k8sWorkspace(ctx, actor, id, models.RoleDeveloper)
	if err != nil {
		return nil, err
	}
	if mem.Role == models.RoleViewer {
		return nil, store.ErrForbidden
	}
	if !k8sWorkspaceReady(w.Status) {
		return nil, fmt.Errorf("工作区未就绪（%s），无法 apply", w.Status)
	}
	if err := a.requireLiveK8s(ctx, w.Runtime); err != nil {
		return nil, err
	}
	if err := a.syncK8sPullSecrets(ctx, w.RuntimeRef); err != nil {
		return nil, err
	}
	res, err := a.K8s.Apply(ctx, w.RuntimeRef, yamlText)
	if err != nil {
		_ = a.Store.AddAudit(ctx, models.AuditLog{
			ActorUserID: actor.ID, Action: "k8s.apply.deny",
			ResourceType: "workspace", ResourceID: w.ID.String(),
			Meta: map[string]any{"workspace_name": w.Name, "error": err.Error()},
		})
		return nil, err
	}
	out := make([]map[string]string, 0, len(res))
	for _, r := range res {
		out = append(out, map[string]string{"kind": r.Kind, "name": r.Name, "namespace": r.Namespace})
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: actor.ID, Action: "k8s.apply",
		ResourceType: "workspace", ResourceID: w.ID.String(),
		Meta: map[string]any{"workspace_name": w.Name, "count": len(out)},
	})
	return out, nil
}

func (a *App) ListK8sResources(ctx context.Context, actor models.User, id uuid.UUID) ([]map[string]string, error) {
	w, _, err := a.k8sWorkspace(ctx, actor, id, models.RoleViewer)
	if err != nil {
		return nil, err
	}
	res, err := a.K8s.Resources(ctx, w.RuntimeRef)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]string, 0, len(res))
	for _, r := range res {
		out = append(out, map[string]string{"kind": r.Kind, "name": r.Name, "namespace": r.Namespace})
	}
	return out, nil
}

func (a *App) DeleteK8sResource(ctx context.Context, actor models.User, id uuid.UUID, kind, name string) error {
	w, _, err := a.k8sWorkspace(ctx, actor, id, models.RoleDeveloper)
	if err != nil {
		return err
	}
	kind = strings.TrimSpace(kind)
	name = strings.TrimSpace(name)
	if kind == "" || name == "" {
		return store.ErrInvalidInput
	}
	if err := a.K8s.Delete(ctx, w.RuntimeRef, kind, name); err != nil {
		return err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: actor.ID, Action: "k8s.delete",
		ResourceType: "workspace", ResourceID: w.ID.String(),
		Meta: map[string]any{"workspace_name": w.Name, "kind": kind, "name": name},
	})
	return nil
}

func (a *App) WorkspaceKubeconfig(ctx context.Context, actor models.User, id uuid.UUID) (string, error) {
	w, _, err := a.k8sWorkspace(ctx, actor, id, models.RoleDeveloper)
	if err != nil {
		return "", err
	}
	kc, err := a.K8s.Kubeconfig(w.RuntimeRef)
	if err != nil {
		return "", err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: actor.ID, Action: "kubeconfig.download",
		ResourceType: "workspace", ResourceID: w.ID.String(),
		Meta: map[string]any{"workspace_name": w.Name},
	})
	return kc, nil
}

func (a *App) requireK8sOrErr(w *models.Workspace) error {
	if w == nil || !models.IsK8sRuntime(w.Runtime) {
		return nil
	}
	return errors.New("Kubernetes 工作区请用 apply / kubeconfig，不支持 SSH 执行")
}

func (a *App) syncK8sPullSecrets(ctx context.Context, ns string) error {
	if a.K8s == nil || strings.TrimSpace(ns) == "" {
		return hak8s.ErrUnavailable
	}
	regs, err := a.CollectAutoInjectRegistryCreds(ctx)
	if err != nil {
		return fmt.Errorf("docker registries: %w", err)
	}
	return a.K8s.SyncPullSecrets(ctx, ns, regs)
}
