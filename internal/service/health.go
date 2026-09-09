package service

import (
	"context"
	"time"

	"ha-cluster/internal/models"
)

const (
	nodeDegradedAfter = 90 * time.Second
	nodeOfflineAfter  = 180 * time.Second
)

// RefreshNodeHealth updates node health_status from heartbeat age without destroying workloads.
func (a *App) RefreshNodeHealth(ctx context.Context) (degraded, offline int, err error) {
	nodes, err := a.Store.ListNodes(ctx)
	if err != nil {
		return 0, 0, err
	}
	now := time.Now()
	for _, n := range nodes {
		if n.Role == "control-plane" {
			continue
		}
		age := now.Sub(n.LastHeartbeat)
		prev := n.HealthStatus
		prevReady := n.Ready
		prevPath := n.FabricPath
		if age <= nodeDegradedAfter {
			n.HealthStatus = models.NodeHealthy
			n.Ready = true
			if n.FabricPath == "degraded" || n.FabricPath == "offline" || n.FabricPath == "stale" {
				n.FabricPath = "p2p"
			}
		} else if age <= nodeOfflineAfter {
			n.HealthStatus = models.NodeDegraded
			n.Ready = false
			n.FabricPath = "degraded"
		} else {
			n.HealthStatus = models.NodeOffline
			n.Ready = false
			n.FabricPath = "offline"
		}
		if n.HealthStatus != prev || n.Ready != prevReady || n.FabricPath != prevPath {
			_ = a.Store.UpsertNode(ctx, &n)
		}
		switch n.HealthStatus {
		case models.NodeDegraded:
			degraded++
		case models.NodeOffline:
			offline++
		}
	}
	return degraded, offline, nil
}
