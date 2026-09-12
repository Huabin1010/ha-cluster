package service

import (
	"context"
	"errors"
	"log"
	"os"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

// provisionSync 为 true 时 Create/Approve 同步等待 Launch（单元测试用）。
func provisionSync() bool {
	return os.Getenv("HA_PROVISION_SYNC") == "1"
}

func (a *App) abortInFlightProvision(id uuid.UUID) {
	if v, ok := a.provisionCancel.Load(id); ok {
		if cancel, ok := v.(context.CancelFunc); ok {
			cancel()
		}
	}
}

func (a *App) startProvision(w *models.Workspace, node models.Node, allocID, actorID uuid.UUID, action string) (*models.Workspace, error) {
	if provisionSync() {
		return a.finishProvision(context.Background(), w, node, allocID, actorID, action)
	}
	go a.runProvisionBackground(w.ID, node, allocID, actorID, action)
	return w, nil
}

func (a *App) runProvisionBackground(wsID uuid.UUID, node models.Node, allocID, actorID uuid.UUID, action string) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	a.provisionCancel.Store(wsID, cancel)
	defer func() {
		cancel()
		a.provisionCancel.Delete(wsID)
	}()

	w, err := a.Store.GetWorkspace(context.Background(), wsID)
	if err != nil {
		log.Printf("provision %s: load workspace: %v", wsID, err)
		_ = a.Ledger.Release(context.Background(), allocID)
		return
	}
	if !models.ProvisioningLive(w.Status) {
		return
	}
	if _, err := a.finishProvision(ctx, w, node, allocID, actorID, action); err != nil {
		log.Printf("provision %s on %s: %v", wsID, node.Name, err)
	}
}

// ReconcileStuckProvisioning 将长时间未完成的 provisioning 标记为 failed 并释放账本。
func (a *App) ReconcileStuckProvisioning(ctx context.Context, maxAge time.Duration) (int, error) {
	if maxAge <= 0 {
		maxAge = 20 * time.Minute
	}
	wss, err := a.Store.ListWorkspaces(ctx, nil)
	if err != nil {
		return 0, err
	}
	var n int
	now := time.Now()
	for _, w := range wss {
		if !models.ProvisioningLive(w.Status) {
			continue
		}
		if now.Sub(w.UpdatedAt) < maxAge {
			continue
		}
		log.Printf("reconcile: stuck provisioning workspace %s (age %s)", w.ID, now.Sub(w.UpdatedAt).Round(time.Second))
		_ = a.Runtime.Destroy(ctx, w.ID)
		if w.AllocationID != uuid.Nil {
			_ = a.Ledger.Release(ctx, w.AllocationID)
		}
		w.Status = models.WSFailed
		w.UpdatedAt = now
		if err := a.Store.UpdateWorkspaceIfStatus(ctx, &w, models.WSProvisioning); err != nil {
			if errors.Is(err, store.ErrConflict) {
				continue
			}
			return n, err
		}
		n++
	}
	return n, nil
}
