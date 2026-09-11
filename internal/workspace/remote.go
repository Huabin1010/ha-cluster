package workspace

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
)

type NodeFinder interface {
	GetNode(ctx context.Context, id uuid.UUID) (*models.Node, error)
	GetWorkspace(ctx context.Context, id uuid.UUID) (*models.Workspace, error)
}

type RemoteAgentRuntime struct {
	Client        *http.Client
	Token         string
	NodeFinder    NodeFinder
	FallbackLocal Runtime
	Port          int

	mu       sync.RWMutex
	nodeByID map[uuid.UUID]uuid.UUID // wsID -> nodeID
}

func NewRemoteAgentRuntime(finder NodeFinder, token string, fallback Runtime) *RemoteAgentRuntime {
	if fallback == nil {
		fallback = NewMemoryRuntime()
	}
	if token == "" {
		token = os.Getenv("HA_NODE_TOKEN")
		if token == "" {
			token = os.Getenv("HA_INTERNAL_TOKEN")
		}
	}
	return &RemoteAgentRuntime{
		Client:        &http.Client{Timeout: 5 * time.Minute},
		Token:         strings.TrimSpace(token),
		NodeFinder:    finder,
		FallbackLocal: fallback,
		Port:          9091,
		nodeByID:      make(map[uuid.UUID]uuid.UUID),
	}
}

func (r *RemoteAgentRuntime) resolveNode(ctx context.Context, wsID uuid.UUID) (*models.Node, error) {
	r.mu.RLock()
	nID, ok := r.nodeByID[wsID]
	r.mu.RUnlock()

	if !ok && r.NodeFinder != nil {
		ws, err := r.NodeFinder.GetWorkspace(ctx, wsID)
		if err == nil && ws != nil && ws.NodeID != uuid.Nil {
			nID = ws.NodeID
			r.mu.Lock()
			r.nodeByID[wsID] = nID
			r.mu.Unlock()
			ok = true
		}
	}

	if ok && r.NodeFinder != nil {
		return r.NodeFinder.GetNode(ctx, nID)
	}
	return nil, fmt.Errorf("node for workspace %s not found", wsID)
}

func agentReachHost(n *models.Node) string {
	if n == nil {
		return ""
	}
	if os.Getenv("HA_AGENT_VIA_LAN") == "1" && strings.TrimSpace(n.LanIP) != "" {
		return strings.TrimSpace(n.LanIP)
	}
	return strings.TrimSpace(n.FabricIP)
}

func (r *RemoteAgentRuntime) targetURL(host, path string) string {
	port := r.Port
	if port <= 0 {
		port = 9091
	}
	return fmt.Sprintf("http://%s:%d%s", host, port, path)
}

func (r *RemoteAgentRuntime) postJSON(ctx context.Context, node *models.Node, path string, in any, out any) error {
	host := agentReachHost(node)
	if host == "" {
		return fmt.Errorf("agent host for node %s not set", node.Name)
	}
	b, err := json.Marshal(in)
	if err != nil {
		return err
	}
	u := r.targetURL(host, path)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if r.Token != "" {
		req.Header.Set("X-HA-Node-Token", r.Token)
		req.Header.Set("Authorization", "Bearer "+r.Token)
	}
	resp, err := r.Client.Do(req)
	if err != nil {
		return fmt.Errorf("agent call %s failed: %w", u, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("agent %s returned %d: %s", u, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}

func (r *RemoteAgentRuntime) Launch(ctx context.Context, w models.Workspace, node models.Node, sshKeys []string) (Instance, error) {
	if node.FabricIP == "" {
		if r.FallbackLocal != nil {
			inst, err := r.FallbackLocal.Launch(ctx, w, node, sshKeys)
			if err == nil {
				r.mu.Lock()
				r.nodeByID[w.ID] = node.ID
				r.mu.Unlock()
			}
			return inst, err
		}
	}

	lc := LaunchContextFrom(ctx, sshKeys)
	payload := map[string]any{
		"workspace":         w,
		"node":              node,
		"ssh_keys":          lc.SSHKeys,
		"docker_registries": lc.DockerRegistries,
	}
	var inst Instance
	err := r.postJSON(ctx, &node, "/v1/workspaces/launch", payload, &inst)
	if err != nil {
		if r.FallbackLocal != nil && os.Getenv("HA_AGENT_ALLOW_MEMORY_FALLBACK") == "1" {
			localInst, localErr := r.FallbackLocal.Launch(ctx, w, node, sshKeys)
			if localErr == nil {
				r.mu.Lock()
				r.nodeByID[w.ID] = node.ID
				r.mu.Unlock()
				return localInst, nil
			}
		}
		return Instance{}, err
	}
	r.mu.Lock()
	r.nodeByID[w.ID] = node.ID
	r.mu.Unlock()
	return inst, nil
}

func (r *RemoteAgentRuntime) Stop(ctx context.Context, id uuid.UUID) error {
	node, err := r.resolveNode(ctx, id)
	if err != nil || node.FabricIP == "" {
		if r.FallbackLocal != nil {
			return r.FallbackLocal.Stop(ctx, id)
		}
		if err != nil {
			return err
		}
	}
	if err := r.postJSON(ctx, node, "/v1/workspaces/stop", map[string]any{"workspace_id": id}, nil); err != nil {
		if r.FallbackLocal != nil {
			return r.FallbackLocal.Stop(ctx, id)
		}
		return err
	}
	return nil
}

func (r *RemoteAgentRuntime) Start(ctx context.Context, id uuid.UUID) error {
	node, err := r.resolveNode(ctx, id)
	if err != nil || node.FabricIP == "" {
		if r.FallbackLocal != nil {
			return r.FallbackLocal.Start(ctx, id)
		}
		if err != nil {
			return err
		}
	}
	if err := r.postJSON(ctx, node, "/v1/workspaces/start", map[string]any{"workspace_id": id}, nil); err != nil {
		if r.FallbackLocal != nil {
			return r.FallbackLocal.Start(ctx, id)
		}
		return err
	}
	return nil
}

func (r *RemoteAgentRuntime) Destroy(ctx context.Context, id uuid.UUID) error {
	node, err := r.resolveNode(ctx, id)
	defer func() {
		r.mu.Lock()
		delete(r.nodeByID, id)
		r.mu.Unlock()
	}()

	if err != nil || node.FabricIP == "" {
		if r.FallbackLocal != nil {
			return r.FallbackLocal.Destroy(ctx, id)
		}
		if err != nil {
			return err
		}
	}
	if err := r.postJSON(ctx, node, "/v1/workspaces/destroy", map[string]any{"workspace_id": id}, nil); err != nil {
		if r.FallbackLocal != nil {
			return r.FallbackLocal.Destroy(ctx, id)
		}
		return err
	}
	return nil
}

func (r *RemoteAgentRuntime) Resize(ctx context.Context, w models.Workspace) error {
	nodeID := w.NodeID
	var node *models.Node
	var err error
	if nodeID != uuid.Nil && r.NodeFinder != nil {
		node, err = r.NodeFinder.GetNode(ctx, nodeID)
	} else {
		node, err = r.resolveNode(ctx, w.ID)
	}
	if err != nil || node.FabricIP == "" {
		if r.FallbackLocal != nil {
			return r.FallbackLocal.Resize(ctx, w)
		}
		if err != nil {
			return err
		}
	}
	if err := r.postJSON(ctx, node, "/v1/workspaces/resize", map[string]any{"workspace": w}, nil); err != nil {
		if r.FallbackLocal != nil {
			return r.FallbackLocal.Resize(ctx, w)
		}
		return err
	}
	return nil
}

func (r *RemoteAgentRuntime) Get(ctx context.Context, id uuid.UUID) (Instance, bool) {
	inst, ok, err := r.GetStrict(ctx, id)
	if err != nil || !ok {
		if r.FallbackLocal != nil {
			return r.FallbackLocal.Get(ctx, id)
		}
		return Instance{}, false
	}
	return inst, true
}

// GetStrict queries the worker agent only (no MemoryRuntime fallback).
func (r *RemoteAgentRuntime) GetStrict(ctx context.Context, id uuid.UUID) (Instance, bool, error) {
	node, err := r.resolveNode(ctx, id)
	if err != nil {
		return Instance{}, false, err
	}
	if agentReachHost(node) == "" {
		return Instance{}, false, fmt.Errorf("agent host for node %s not set", node.Name)
	}
	var inst Instance
	if err := r.postJSON(ctx, node, "/v1/workspaces/get", map[string]any{"workspace_id": id}, &inst); err != nil {
		return Instance{}, false, err
	}
	return inst, true, nil
}

// AgentReachable checks ha-agent /healthz on the worker (LAN or fabric IP).
func (r *RemoteAgentRuntime) AgentReachable(ctx context.Context, node *models.Node) bool {
	host := agentReachHost(node)
	if host == "" {
		return false
	}
	u := r.targetURL(host, "/healthz")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return false
	}
	if r.Token != "" {
		req.Header.Set("X-HA-Node-Token", r.Token)
		req.Header.Set("Authorization", "Bearer "+r.Token)
	}
	resp, err := r.Client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func (r *RemoteAgentRuntime) ExposePort(ctx context.Context, wsID, routeID uuid.UUID, containerPort int) (int, error) {
	node, err := r.resolveNode(ctx, wsID)
	if err != nil || node.FabricIP == "" {
		if r.FallbackLocal != nil {
			return r.FallbackLocal.ExposePort(ctx, wsID, routeID, containerPort)
		}
		if err != nil {
			return 0, err
		}
	}
	var out struct {
		HostPort int `json:"host_port"`
	}
	if err := r.postJSON(ctx, node, "/v1/workspaces/expose-port", map[string]any{
		"workspace_id":   wsID,
		"route_id":       routeID,
		"container_port": containerPort,
	}, &out); err != nil {
		if r.FallbackLocal != nil {
			return r.FallbackLocal.ExposePort(ctx, wsID, routeID, containerPort)
		}
		return 0, err
	}
	return out.HostPort, nil
}

func (r *RemoteAgentRuntime) UnexposePort(ctx context.Context, wsID, routeID uuid.UUID) error {
	node, err := r.resolveNode(ctx, wsID)
	if err != nil || node.FabricIP == "" {
		if r.FallbackLocal != nil {
			return r.FallbackLocal.UnexposePort(ctx, wsID, routeID)
		}
		if err != nil {
			return err
		}
	}
	if err := r.postJSON(ctx, node, "/v1/workspaces/unexpose-port", map[string]any{
		"workspace_id": wsID,
		"route_id":     routeID,
	}, nil); err != nil {
		if r.FallbackLocal != nil {
			return r.FallbackLocal.UnexposePort(ctx, wsID, routeID)
		}
		return err
	}
	return nil
}

func (r *RemoteAgentRuntime) SyncKeys(ctx context.Context, id uuid.UUID, keys []string) error {
	node, err := r.resolveNode(ctx, id)
	if err != nil || node.FabricIP == "" {
		if r.FallbackLocal != nil {
			return r.FallbackLocal.SyncKeys(ctx, id, keys)
		}
		if err != nil {
			return err
		}
	}
	payload := map[string]any{
		"workspace_id": id,
		"ssh_keys":     keys,
	}
	if err := r.postJSON(ctx, node, "/v1/workspaces/sync-keys", payload, nil); err != nil {
		if r.FallbackLocal != nil {
			return r.FallbackLocal.SyncKeys(ctx, id, keys)
		}
		return err
	}
	return nil
}
