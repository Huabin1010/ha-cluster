package service

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

func (a *App) k8sWorkspace(ctx context.Context, actor models.User, id uuid.UUID, minRole string) (*models.Workspace, *models.Membership, error) {
	w, err := a.Store.GetWorkspace(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	mem, err := a.RequireMembership(ctx, actor, w.ProjectID, minRole)
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
	if w.Status != models.WSRunning {
		return nil, store.ErrInvalidInput
	}
	if mem.Role == models.RoleViewer {
		return nil, store.ErrForbidden
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

