package service

import (
	"context"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/workspace"
)

func (a *App) nodesWithActiveWorkspaces(ctx context.Context) (map[uuid.UUID]bool, error) {
	wss, err := a.Store.ListWorkspaces(ctx, nil)
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID]bool)
	for _, w := range wss {
		if w.NodeID == uuid.Nil {
			continue
		}
		switch w.Status {
		case models.WSRunning, models.WSStopped, models.WSSuspended, models.WSDegraded,
			models.WSProvisioning, models.WSNodeLost:
			out[w.NodeID] = true
		}
	}
	return out, nil
}

func workspaceHealthActive(status string) bool {
	switch status {
	case models.WSRunning, models.WSStopped, models.WSSuspended, models.WSDegraded, models.WSNodeLost:
		return true
	default:
		return false
	}
}

func instanceStatus(running bool) string {
	if running {
		return models.WSRunning
	}
	return models.WSStopped
}

// ReconcileWorkspaceHealth maps node health / agent reality to workspace status.
func (a *App) ReconcileWorkspaceHealth(ctx context.Context) (updated int, err error) {
	wss, err := a.Store.ListWorkspaces(ctx, nil)
	if err != nil {
		return 0, err
	}
	rem, _ := a.Runtime.(*workspace.RemoteAgentRuntime)

	for _, w := range wss {
		if !workspaceHealthActive(w.Status) {
			continue
		}
		if w.NodeID == uuid.Nil {
			continue
		}

		n, nerr := a.Store.GetNode(ctx, w.NodeID)
		newStatus := w.Status

		if nerr != nil {
			newStatus = models.WSNodeLost
		} else {
			switch n.HealthStatus {
			case models.NodeOffline:
				newStatus = models.WSNodeLost
			case models.NodeDegraded:
				if w.Status == models.WSRunning {
					newStatus = models.WSDegraded
				}
			case models.NodeHealthy:
				if rem != nil {
					inst, ok, gerr := rem.GetStrict(ctx, w.ID)
					if gerr == nil && ok {
						newStatus = instanceStatus(inst.Running)
					} else if w.Status == models.WSRunning {
						newStatus = models.WSDegraded
					}
				} else if w.Status == models.WSNodeLost {
					newStatus = models.WSRunning
				}
			}
		}

		if newStatus == w.Status {
			continue
		}
		w.Status = newStatus
		w.UpdatedAt = time.Now()
		if err := a.Store.UpdateWorkspace(ctx, &w); err != nil {
			return updated, err
		}
		updated++
	}
	return updated, nil
}
