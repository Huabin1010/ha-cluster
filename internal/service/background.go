package service

import (
	"context"
	"log"
	"time"
)

// StartBackgroundTasks runs periodic health, idle suspend, and reconcile loops.
func StartBackgroundTasks(ctx context.Context, app *App) {
	go func() {
		t := time.NewTicker(30 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				d, o, err := app.RefreshNodeHealth(context.Background())
				if err != nil {
					log.Printf("node health refresh: %v", err)
				} else if d > 0 || o > 0 {
					log.Printf("node health: degraded=%d offline=%d", d, o)
				}
			}
		}
	}()

	go func() {
		t := time.NewTicker(5 * time.Minute)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				n, err := app.SuspendIdleWorkspaces(context.Background())
				if err != nil {
					log.Printf("idle suspend: %v", err)
				} else if n > 0 {
					log.Printf("idle suspend: suspended %d workspaces", n)
				}
			}
		}
	}()

	go func() {
		t := time.NewTicker(2 * time.Minute)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if n, err := app.ReconcileStuckProvisioning(context.Background(), 20*time.Minute); err != nil {
					log.Printf("stuck provisioning: %v", err)
				} else if n > 0 {
					log.Printf("stuck provisioning: failed %d workspaces", n)
				}
			}
		}
	}()

	go func() {
		t := time.NewTicker(10 * time.Minute)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				released, stale, err := app.Reconcile(context.Background())
				if err != nil {
					log.Printf("reconcile: %v", err)
				} else if released > 0 || stale > 0 {
					log.Printf("reconcile: released=%d stale_nodes=%d", released, stale)
				}
			}
		}
	}()
}
