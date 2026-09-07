package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/workspace"
)

type LaunchRequest struct {
	Workspace models.Workspace `json:"workspace"`
	Node      models.Node      `json:"node"`
	SSHKeys   []string         `json:"ssh_keys"`
}

type IDRequest struct {
	WorkspaceID uuid.UUID `json:"workspace_id"`
}

type ResizeRequest struct {
	Workspace models.Workspace `json:"workspace"`
}

type ExposePortRequest struct {
	WorkspaceID   uuid.UUID `json:"workspace_id"`
	RouteID       uuid.UUID `json:"route_id"`
	ContainerPort int       `json:"container_port"`
}

type UnexposePortRequest struct {
	WorkspaceID uuid.UUID `json:"workspace_id"`
	RouteID     uuid.UUID `json:"route_id"`
}

type SyncKeysRequest struct {
	WorkspaceID uuid.UUID `json:"workspace_id"`
	SSHKeys     []string  `json:"ssh_keys"`
}

type Server struct {
	Runtime workspace.Runtime
	Token   string
	Addr    string
	server  *http.Server
}

func NewServer(rt workspace.Runtime, token, addr string) *Server {
	if rt == nil {
		rt = workspace.PickRuntime()
	}
	return &Server{
		Runtime: rt,
		Token:   strings.TrimSpace(token),
		Addr:    addr,
	}
}

func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.Token != "" {
			tok := r.Header.Get("X-HA-Node-Token")
			if tok == "" {
				authHeader := r.Header.Get("Authorization")
				if strings.HasPrefix(authHeader, "Bearer ") {
					tok = strings.TrimPrefix(authHeader, "Bearer ")
				}
			}
			if tok != s.Token {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
		}
		next(w, r)
	}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("POST /v1/workspaces/launch", s.auth(s.handleLaunch))
	mux.HandleFunc("POST /v1/workspaces/stop", s.auth(s.handleStop))
	mux.HandleFunc("POST /v1/workspaces/start", s.auth(s.handleStart))
	mux.HandleFunc("POST /v1/workspaces/destroy", s.auth(s.handleDestroy))
	mux.HandleFunc("POST /v1/workspaces/resize", s.auth(s.handleResize))
	mux.HandleFunc("POST /v1/workspaces/get", s.auth(s.handleGet))
	mux.HandleFunc("POST /v1/workspaces/expose-port", s.auth(s.handleExposePort))
	mux.HandleFunc("POST /v1/workspaces/unexpose-port", s.auth(s.handleUnexposePort))
	mux.HandleFunc("POST /v1/workspaces/sync-keys", s.auth(s.handleSyncKeys))
	return mux
}

func (s *Server) handleLaunch(w http.ResponseWriter, r *http.Request) {
	var req LaunchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"invalid json: %v"}`, err), http.StatusBadRequest)
		return
	}
	inst, err := s.Runtime.Launch(r.Context(), req.Workspace, req.Node, req.SSHKeys)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(inst)
}

func (s *Server) handleStop(w http.ResponseWriter, r *http.Request) {
	var req IDRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"invalid json: %v"}`, err), http.StatusBadRequest)
		return
	}
	if err := s.Runtime.Stop(r.Context(), req.WorkspaceID); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"stopped"}`))
}

func (s *Server) handleStart(w http.ResponseWriter, r *http.Request) {
	var req IDRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"invalid json: %v"}`, err), http.StatusBadRequest)
		return
	}
	if err := s.Runtime.Start(r.Context(), req.WorkspaceID); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"started"}`))
}

func (s *Server) handleDestroy(w http.ResponseWriter, r *http.Request) {
	var req IDRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"invalid json: %v"}`, err), http.StatusBadRequest)
		return
	}
	if err := s.Runtime.Destroy(r.Context(), req.WorkspaceID); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"destroyed"}`))
}

func (s *Server) handleResize(w http.ResponseWriter, r *http.Request) {
	var req ResizeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"invalid json: %v"}`, err), http.StatusBadRequest)
		return
	}
	if err := s.Runtime.Resize(r.Context(), req.Workspace); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"resized"}`))
}

func (s *Server) handleGet(w http.ResponseWriter, r *http.Request) {
	var req IDRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"invalid json: %v"}`, err), http.StatusBadRequest)
		return
	}
	inst, ok := s.Runtime.Get(r.Context(), req.WorkspaceID)
	if !ok {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(inst)
}

func (s *Server) handleExposePort(w http.ResponseWriter, r *http.Request) {
	var req ExposePortRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"invalid json: %v"}`, err), http.StatusBadRequest)
		return
	}
	hostPort, err := s.Runtime.ExposePort(r.Context(), req.WorkspaceID, req.RouteID, req.ContainerPort)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]int{"host_port": hostPort})
}

func (s *Server) handleUnexposePort(w http.ResponseWriter, r *http.Request) {
	var req UnexposePortRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"invalid json: %v"}`, err), http.StatusBadRequest)
		return
	}
	if err := s.Runtime.UnexposePort(r.Context(), req.WorkspaceID, req.RouteID); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"unexposed"}`))
}

func (s *Server) handleSyncKeys(w http.ResponseWriter, r *http.Request) {
	var req SyncKeysRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"invalid json: %v"}`, err), http.StatusBadRequest)
		return
	}
	if err := s.Runtime.SyncKeys(r.Context(), req.WorkspaceID, req.SSHKeys); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"synced"}`))
}

func (s *Server) ListenAndServe() error {
	addr := s.Addr
	if addr == "" {
		addr = ":9091"
	}
	s.server = &http.Server{
		Addr:         addr,
		Handler:      s.Routes(),
		ReadTimeout:  15 * time.Minute,
		WriteTimeout: 15 * time.Minute,
	}
	return s.server.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	if s.server != nil {
		return s.server.Shutdown(ctx)
	}
	return nil
}
