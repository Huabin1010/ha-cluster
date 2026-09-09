package service

import (
	"context"
	"os"
	"strconv"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
)

func defaultIdleSuspendHours() int {
	if v := os.Getenv("HA_IDLE_SUSPEND_HOURS"); v != "" {
		if h, err := strconv.Atoi(v); err == nil && h > 0 {
			return h
		}
	}
	return 2
}

func idleThreshold(w models.Workspace) time.Duration {
	h := w.IdleSuspendHours
	if h <= 0 {
		h = defaultIdleSuspendHours()
	}
	return time.Duration(h) * time.Hour
}

func (a *App) touchWorkspaceActivity(ctx context.Context, w *models.Workspace) {
	now := time.Now()
	w.LastActivityAt = now
	w.UpdatedAt = now
	_ = a.Store.UpdateWorkspace(ctx, w)
}

// SuspendIdleWorkspaces stops running workspaces that exceeded idle threshold.
func (a *App) SuspendIdleWorkspaces(ctx context.Context) (suspended int, err error) {
	wss, err := a.Store.ListWorkspaces(ctx, nil)
	if err != nil {
		return 0, err
	}
	now := time.Now()
	for _, w := range wss {
		if w.Status != models.WSRunning && w.Status != models.WSDegraded {
			continue
		}
		last := w.LastActivityAt
		if last.IsZero() {
			last = w.UpdatedAt
		}
		if last.IsZero() {
			last = w.CreatedAt
		}
		if now.Sub(last) < idleThreshold(w) {
			continue
		}
		if err := a.Runtime.Stop(ctx, w.ID); err != nil {
			continue
		}
		w.Status = models.WSSuspended
		w.UpdatedAt = now
		if err := a.Store.UpdateWorkspace(ctx, &w); err != nil {
			continue
		}
		suspended++
		_ = a.Store.AddAudit(ctx, models.AuditLog{
			ActorUserID: w.OwnerUserID, Action: "workspace.idle_suspend",
			ResourceType: "workspace", ResourceID: w.ID.String(),
			Meta: map[string]any{"idle_hours": w.IdleSuspendHours},
		})
	}
	return suspended, nil
}

// WakeWorkspaceIfSuspended starts a suspended workspace (e.g. before SSH).
func (a *App) WakeWorkspaceIfSuspended(ctx context.Context, w *models.Workspace) error {
	if w.Status != models.WSSuspended && w.Status != models.WSStopped {
		return nil
	}
	if err := a.Runtime.Start(ctx, w.ID); err != nil {
		return err
	}
	now := time.Now()
	w.Status = models.WSRunning
	w.LastActivityAt = now
	w.UpdatedAt = now
	return a.Store.UpdateWorkspace(ctx, w)
}

// ApplyResizeImmediately applies a resize without approval for platform admins.
func (a *App) ApplyResizeImmediately(ctx context.Context, actor models.User, id uuid.UUID, cpu, mem, disk int64) (*models.Workspace, error) {
	w, err := a.RequestResize(ctx, actor, id, cpu, mem, disk)
	if err != nil {
		return nil, err
	}
	if actor.PlatformRole == models.RolePlatformAdmin {
		return a.ApproveResize(ctx, actor, id)
	}
	return w, nil
}
