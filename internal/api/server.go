package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/google/uuid"

	"ha-cluster/internal/auth"
	"ha-cluster/internal/models"
	"ha-cluster/internal/service"
	"ha-cluster/internal/store"
)

type Server struct {
	App *service.App
}

func New(app *service.App) http.Handler {
	s := &Server{App: app}
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		ExposedHeaders:   []string{"X-Total-Count"},
		AllowCredentials: true,
	}))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	r.Get("/readyz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	})

	r.Post("/auth/register", s.register)
	r.Post("/auth/login", s.login)
	r.Post("/auth/refresh", s.refresh)
	r.Post("/auth/logout", s.logout)
	r.Post("/nodes/heartbeat", s.heartbeat)
	r.Get("/internal/authorized-keys", s.authorizedKeys)
	r.Get("/internal/ssh-target", s.internalSSHTarget)

	r.Group(func(r chi.Router) {
		r.Use(s.authn)
		r.Get("/me", s.me)
		r.Get("/me/ssh-keys", s.listKeys)
		r.Post("/me/ssh-keys", s.addKey)
		r.Delete("/me/ssh-keys/{id}", s.deleteKey)

		r.Get("/projects", s.listProjects)
		r.Post("/projects", s.createProject)
		r.Get("/projects/{id}", s.getProject)
		r.Get("/projects/{id}/usage", s.projectUsage)
		r.Get("/projects/{id}/members", s.listMembers)
		r.Post("/projects/{id}/members", s.addMember)
		r.Delete("/projects/{id}/members/{uid}", s.removeMember)
		r.Post("/projects/{id}/workspaces", s.createWorkspace)
		r.Post("/projects/{id}/invitations", s.invite)
		r.Patch("/projects/{id}", s.patchProject)

		r.Post("/invitations/accept", s.acceptInvite)
		r.Post("/admin/reconcile", s.reconcile)
		r.Post("/users/{id}/suspend", s.suspend)

		r.Get("/workspaces", s.listWorkspaces)
		r.Get("/workspaces/{id}", s.getWorkspace)
		r.Post("/workspaces/{id}/stop", s.stopWorkspace)
		r.Post("/workspaces/{id}/start", s.startWorkspace)
		r.Delete("/workspaces/{id}", s.destroyWorkspace)
		r.Get("/workspaces/{id}/ssh-target", s.sshTarget)
		r.Get("/workspaces/{id}/ssh-config", s.sshConfig)

		r.Get("/nodes", s.listNodes)
		r.Get("/capacity", s.capacity)
		r.Get("/plans", s.plans)
		r.Get("/audit-logs", s.audit)
		r.Post("/allocations/{id}/release", s.releaseAlloc)
		r.Get("/users", s.listUsers)
	})
	return r
}

type ctxKey int

const userKey ctxKey = 1

func (s *Server) authn(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		if !strings.HasPrefix(h, "Bearer ") {
			writeErr(w, http.StatusUnauthorized, store.ErrUnauthorized)
			return
		}
		c, err := auth.ParseAccess(s.App.JWT, strings.TrimPrefix(h, "Bearer "))
		if err != nil {
			writeErr(w, http.StatusUnauthorized, store.ErrUnauthorized)
			return
		}
		u, err := s.App.Store.GetUserByID(r.Context(), c.UserID)
		if err != nil || u.Status != models.UserActive || u.TokenVersion != c.TokenVersion {
			writeErr(w, http.StatusUnauthorized, store.ErrUnauthorized)
			return
		}
		next.ServeHTTP(w, r.WithContext(contextWithUser(r.Context(), u)))
	})
}

func contextWithUser(ctx context.Context, u *models.User) context.Context {
	return context.WithValue(ctx, userKey, u)
}

func userFrom(r *http.Request) *models.User {
	u, _ := r.Context().Value(userKey).(*models.User)
	return u
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, err error) {
	msg := err.Error()
	if errors.Is(err, store.ErrNoCapacity) {
		code = http.StatusConflict
		msg = "INSUFFICIENT_CAPACITY"
	} else if errors.Is(err, store.ErrConflict) {
		code = http.StatusConflict
	} else if errors.Is(err, store.ErrNotFound) {
		code = http.StatusNotFound
	} else if errors.Is(err, store.ErrForbidden) {
		code = http.StatusForbidden
	} else if errors.Is(err, store.ErrUnauthorized) {
		code = http.StatusUnauthorized
	} else if errors.Is(err, store.ErrInvalidInput) {
		code = http.StatusBadRequest
	}
	writeJSON(w, code, map[string]string{"error": msg})
}

func decodeJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

func listEnvelope(w http.ResponseWriter, items any, total int) {
	w.Header().Set("X-Total-Count", strconv.Itoa(total))
	writeJSON(w, http.StatusOK, map[string]any{"data": items, "total": total})
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	u, err := s.App.Register(r.Context(), body.Username, body.Email, body.Password)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, u)
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	tok, refresh, u, err := s.App.LoginTokens(r.Context(), body.Username, body.Password)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": tok, "refresh_token": refresh, "user": u})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, userFrom(r))
}

func (s *Server) listKeys(w http.ResponseWriter, r *http.Request) {
	keys, err := s.App.Store.ListSSHKeys(r.Context(), userFrom(r).ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	if keys == nil {
		keys = []models.SSHKey{}
	}
	listEnvelope(w, keys, len(keys))
}

func (s *Server) addKey(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name      string `json:"name"`
		PublicKey string `json:"public_key"`
	}
	if err := decodeJSON(r, &body); err != nil || strings.TrimSpace(body.PublicKey) == "" {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	k := &models.SSHKey{
		ID: uuid.New(), UserID: userFrom(r).ID, Name: body.Name,
		PublicKey: body.PublicKey, Fingerprint: service.SSHFingerprint(body.PublicKey),
		CreatedAt: time.Now(),
	}
	if err := s.App.Store.AddSSHKey(r.Context(), k); err != nil {
		writeErr(w, http.StatusConflict, err)
		return
	}
	writeJSON(w, http.StatusCreated, k)
}

func (s *Server) deleteKey(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if err := s.App.Store.DeleteSSHKey(r.Context(), userFrom(r).ID, id); err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listProjects(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	var items []models.Project
	var err error
	if u.PlatformRole == models.RolePlatformAdmin {
		// admin sees all via listing every user — keep simple: scan memberships via users' projects
		users, _ := s.App.Store.ListUsers(r.Context())
		seen := map[uuid.UUID]struct{}{}
		for _, usr := range users {
			ps, _ := s.App.Store.ListProjectsForUser(r.Context(), usr.ID)
			for _, p := range ps {
				if _, ok := seen[p.ID]; !ok {
					seen[p.ID] = struct{}{}
					items = append(items, p)
				}
			}
		}
	} else {
		items, err = s.App.Store.ListProjectsForUser(r.Context(), u.ID)
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	if items == nil {
		items = []models.Project{}
	}
	listEnvelope(w, items, len(items))
}

func (s *Server) createProject(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	p, err := s.App.CreateProject(r.Context(), userFrom(r).ID, body.Name, body.Slug)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (s *Server) getProject(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if _, err := s.App.RequireMembership(r.Context(), *userFrom(r), id, models.RoleViewer); err != nil {
		writeErr(w, http.StatusForbidden, err)
		return
	}
	p, err := s.App.Store.GetProject(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) projectUsage(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if _, err := s.App.RequireMembership(r.Context(), *userFrom(r), id, models.RoleViewer); err != nil {
		writeErr(w, http.StatusForbidden, err)
		return
	}
	wss, _ := s.App.Store.ListWorkspaces(r.Context(), &id)
	var cpu, mem, disk int64
	active := 0
	for _, ws := range wss {
		if ws.Status == models.WSDestroyed || ws.Status == models.WSFailed {
			continue
		}
		if a, err := s.App.Store.GetAllocation(r.Context(), ws.AllocationID); err == nil && a.State != models.AllocReleased {
			cpu += a.CPUMilli
			mem += a.MemBytes
			disk += a.DiskBytes
			active++
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"project_id": id, "workspaces": active,
		"cpu_milli": cpu, "mem_bytes": mem, "disk_bytes": disk,
	})
}

func (s *Server) listMembers(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if _, err := s.App.RequireMembership(r.Context(), *userFrom(r), id, models.RoleViewer); err != nil {
		writeErr(w, http.StatusForbidden, err)
		return
	}
	ms, err := s.App.Store.ListMemberships(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	listEnvelope(w, ms, len(ms))
}

func (s *Server) addMember(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if _, err := s.App.RequireMembership(r.Context(), *userFrom(r), id, models.RoleAdmin); err != nil {
		writeErr(w, http.StatusForbidden, err)
		return
	}
	var body struct {
		Username string `json:"username"`
		Role     string `json:"role"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if models.RoleRank(body.Role) == 0 {
		body.Role = models.RoleDeveloper
	}
	u, err := s.App.Store.GetUserByUsername(r.Context(), body.Username)
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	m := models.Membership{ProjectID: id, UserID: u.ID, Role: body.Role}
	if err := s.App.Store.AddMembership(r.Context(), m); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, m)
}

func (s *Server) removeMember(w http.ResponseWriter, r *http.Request) {
	pid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	uid, err := uuid.Parse(chi.URLParam(r, "uid"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if _, err := s.App.RequireMembership(r.Context(), *userFrom(r), pid, models.RoleAdmin); err != nil {
		writeErr(w, http.StatusForbidden, err)
		return
	}
	if err := s.App.Store.RemoveMembership(r.Context(), pid, uid); err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) createWorkspace(w http.ResponseWriter, r *http.Request) {
	pid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	var body struct {
		Name       string `json:"name"`
		Plan       string `json:"plan"`
		Arch       string `json:"arch"`
		Visibility string `json:"visibility"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	ws, err := s.App.CreateWorkspace(r.Context(), service.CreateWorkspaceInput{
		ProjectID: pid, Name: body.Name, Plan: body.Plan, Arch: body.Arch,
		Visibility: body.Visibility, Actor: *userFrom(r),
	})
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, ws)
}

func (s *Server) listWorkspaces(w http.ResponseWriter, r *http.Request) {
	var pid *uuid.UUID
	if q := r.URL.Query().Get("project_id"); q != "" {
		id, err := uuid.Parse(q)
		if err != nil {
			writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
			return
		}
		pid = &id
		if _, err := s.App.RequireMembership(r.Context(), *userFrom(r), id, models.RoleViewer); err != nil {
			writeErr(w, http.StatusForbidden, err)
			return
		}
	}
	items, err := s.App.Store.ListWorkspaces(r.Context(), pid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	u := userFrom(r)
	if pid == nil && u.PlatformRole != models.RolePlatformAdmin {
		filtered := items[:0]
		for _, ws := range items {
			if _, err := s.App.RequireMembership(r.Context(), *u, ws.ProjectID, models.RoleViewer); err == nil {
				filtered = append(filtered, ws)
			}
		}
		items = filtered
	}
	if items == nil {
		items = []models.Workspace{}
	}
	listEnvelope(w, items, len(items))
}

func (s *Server) getWorkspace(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	ws, err := s.App.Store.GetWorkspace(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	if _, err := s.App.RequireMembership(r.Context(), *userFrom(r), ws.ProjectID, models.RoleViewer); err != nil {
		writeErr(w, http.StatusForbidden, err)
		return
	}
	writeJSON(w, http.StatusOK, ws)
}

func (s *Server) stopWorkspace(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if err := s.App.StopWorkspace(r.Context(), *userFrom(r), id); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "stopped"})
}

func (s *Server) startWorkspace(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if err := s.App.StartWorkspace(r.Context(), *userFrom(r), id); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "running"})
}

func (s *Server) destroyWorkspace(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if err := s.App.DestroyWorkspace(r.Context(), *userFrom(r), id); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) sshTarget(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	ws, n, err := s.App.SSHTarget(r.Context(), *userFrom(r), id)
	if err != nil {
		writeErr(w, http.StatusForbidden, err)
		return
	}
	writeSSHTarget(w, ws, n)
}

func (s *Server) sshConfig(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	ws, _, err := s.App.SSHTarget(r.Context(), *userFrom(r), id)
	if err != nil {
		writeErr(w, http.StatusForbidden, err)
		return
	}
	u := userFrom(r)
	port := bastionSSHPort()
	cfg := "Host ha-" + ws.ID.String()[:8] + "\n" +
		"  HostName bastion.mnnumath.vip\n" +
		"  User " + u.Username + "\n" +
		"  Port " + strconv.Itoa(port) + "\n" +
		"  ForwardAgent yes\n" +
		"  RequestTTY force\n" +
		"  RemoteCommand " + ws.ID.String() + "\n"
	w.Header().Set("Content-Type", "text/plain")
	_, _ = w.Write([]byte(cfg))
}

func bastionSSHPort() int {
	if v := strings.TrimSpace(os.Getenv("HA_BASTION_PORT")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	// Management SSH occupies :22 on vps-1; product bastion listens on 8099.
	return 8099
}

func writeSSHTarget(w http.ResponseWriter, ws *models.Workspace, n *models.Node) {
	host := n.FabricIP
	if host == "" {
		host = n.LanIP
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"workspace_id": ws.ID, "node": n.Name, "host": host, "port": ws.SSHPort,
		"fabric_ip": n.FabricIP, "lan_ip": n.LanIP,
		"fingerprint": ws.HostKeyFP, "breakglass": n.BreakglassSSH,
	})
}

func (s *Server) listNodes(w http.ResponseWriter, r *http.Request) {
	items, err := s.App.Store.ListNodes(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	if items == nil {
		items = []models.Node{}
	}
	listEnvelope(w, items, len(items))
}

func (s *Server) capacity(w http.ResponseWriter, r *http.Request) {
	items, _ := s.App.Store.ListNodes(r.Context())
	type pool struct {
		Arch string `json:"arch"`
		CPU  int64  `json:"cpu_milli_free"`
		Mem  int64  `json:"mem_bytes_free"`
		Disk int64  `json:"disk_bytes_free"`
	}
	pools := map[string]*pool{}
	for _, n := range items {
		if n.Role == "control-plane" {
			continue
		}
		p := pools[n.Arch]
		if p == nil {
			p = &pool{Arch: n.Arch}
			pools[n.Arch] = p
		}
		if n.Ready {
			p.CPU += n.AllocatableCPU - n.UsedCPU
			p.Mem += n.AllocatableMem - n.UsedMem
			p.Disk += n.AllocatableDisk - n.UsedDisk
		}
	}
	out := make([]*pool, 0, len(pools))
	for _, p := range pools {
		out = append(out, p)
	}
	writeJSON(w, http.StatusOK, map[string]any{"nodes": items, "pools": out})
}

func (s *Server) plans(w http.ResponseWriter, r *http.Request) {
	m := models.Plans()
	list := make([]models.Plan, 0, len(m))
	for _, p := range m {
		list = append(list, p)
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) audit(w http.ResponseWriter, r *http.Request) {
	if userFrom(r).PlatformRole != models.RolePlatformAdmin && userFrom(r).PlatformRole != models.RolePlatformOps {
		writeErr(w, http.StatusForbidden, store.ErrForbidden)
		return
	}
	items, _ := s.App.Store.ListAudit(r.Context(), 200)
	listEnvelope(w, items, len(items))
}

func (s *Server) releaseAlloc(w http.ResponseWriter, r *http.Request) {
	if userFrom(r).PlatformRole != models.RolePlatformAdmin {
		writeErr(w, http.StatusForbidden, store.ErrForbidden)
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if err := s.App.Ledger.Release(r.Context(), id); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "released"})
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	if userFrom(r).PlatformRole != models.RolePlatformAdmin {
		writeErr(w, http.StatusForbidden, store.ErrForbidden)
		return
	}
	items, _ := s.App.Store.ListUsers(r.Context())
	listEnvelope(w, items, len(items))
}

func (s *Server) heartbeat(w http.ResponseWriter, r *http.Request) {
	var n models.Node
	if err := decodeJSON(r, &n); err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	out, err := s.App.Heartbeat(r.Context(), n)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}
