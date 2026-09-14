package service

import (
	"context"
	"os"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"ha-cluster/internal/bastion"
	"ha-cluster/internal/models"
	"ha-cluster/internal/webshell"
)

const (
	execProbeInterval = 25 * time.Second
	execProbeTimeout  = 3 * time.Second
	execProbeBudget   = 8 * time.Second
	execProbeWorkers  = 4
	execErrorMaxRunes = 300
)

func (a *App) RecordWorkspaceExec(ctx context.Context, id uuid.UUID, ready bool, errMsg string) {
	if utf8.RuneCountInString(errMsg) > execErrorMaxRunes {
		errMsg = string([]rune(errMsg)[:execErrorMaxRunes]) + "…"
	}
	_ = a.Store.SetWorkspaceExec(ctx, id, ready, errMsg)
}

func workspaceSSHUser() string {
	if v := strings.TrimSpace(os.Getenv("HA_WS_SSH_USER")); v != "" {
		return v
	}
	return "root"
}

func execProbeHost(n models.Node) string {
	if bastion.PreferLAN() && strings.TrimSpace(n.LanIP) != "" {
		return strings.TrimSpace(n.LanIP)
	}
	if ip := strings.TrimSpace(n.FabricIP); ip != "" {
		return ip
	}
	return strings.TrimSpace(n.LanIP)
}

func shouldProbeExec(w models.Workspace) bool {
	if models.IsK8sRuntime(w.Runtime) {
		return false
	}
	if w.Status != models.WSRunning && w.Status != models.WSDegraded {
		return false
	}
	if w.SSHPort <= 0 || w.NodeID == uuid.Nil {
		return false
	}
	if w.ExecCheckedAt.IsZero() {
		return true
	}
	return time.Since(w.ExecCheckedAt) >= execProbeInterval
}

// ProbeWorkspaceExecs tries a short SSH handshake so list/detail can expose exec_ready.
// Skips fake/memory runtimes. Does not change workspace updated_at.
func (a *App) ProbeWorkspaceExecs(ctx context.Context) {
	if webshell.IsFake(a.Runtime) {
		return
	}
	signer := webshell.Signer()
	if signer == nil {
		return
	}
	wss, err := a.Store.ListWorkspaces(ctx, nil)
	if err != nil {
		return
	}
	pctx, cancel := context.WithTimeout(ctx, execProbeBudget)
	defer cancel()

	type job struct {
		ws   models.Workspace
		host string
	}
	var jobs []job
	for _, w := range wss {
		if !shouldProbeExec(w) {
			continue
		}
		n, nerr := a.Store.GetNode(pctx, w.NodeID)
		if nerr != nil {
			a.RecordWorkspaceExec(pctx, w.ID, false, nerr.Error())
			continue
		}
		host := execProbeHost(*n)
		if host == "" {
			continue
		}
		jobs = append(jobs, job{ws: w, host: host})
	}
	if len(jobs) == 0 {
		return
	}

	sem := make(chan struct{}, execProbeWorkers)
	var wg sync.WaitGroup
	for _, j := range jobs {
		j := j
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			err := webshell.ProbeHandshake(pctx, workspaceSSHUser(), j.host, j.ws.SSHPort, signer, execProbeTimeout)
			if err != nil {
				a.RecordWorkspaceExec(pctx, j.ws.ID, false, err.Error())
				return
			}
			a.RecordWorkspaceExec(pctx, j.ws.ID, true, "")
		}()
	}
	wg.Wait()
}
