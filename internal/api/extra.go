package api

import (
	"errors"
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

func (s *Server) refresh(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	access, next, u, err := s.App.RefreshAccess(r.Context(), body.RefreshToken)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": access, "refresh_token": next, "user": u})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RefreshToken string `json:"refresh_token"`
	}
	_ = decodeJSON(r, &body)
	_ = s.App.LogoutRefresh(r.Context(), body.RefreshToken)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) invite(w http.ResponseWriter, r *http.Request) {
	pid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	var body struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	inv, err := s.App.Invite(r.Context(), *userFrom(r), pid, body.Email, body.Role)
	if err != nil {
		writeErr(w, http.StatusForbidden, err)
		return
	}
	writeJSON(w, http.StatusCreated, inv)
}

func (s *Server) acceptInvite(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token string `json:"token"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	pid, err := s.App.AcceptInvite(r.Context(), *userFrom(r), body.Token)
	if err != nil {
		if errors.Is(err, store.ErrConflict) {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "accepted", "project_id": pid.String()})
}

func (s *Server) patchProject(w http.ResponseWriter, r *http.Request) {
	pid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if _, err := s.App.RequireMembership(r.Context(), *userFrom(r), pid, models.RoleOwner); err != nil {
		writeErr(w, http.StatusForbidden, err)
		return
	}
	p, err := s.App.Store.GetProject(r.Context(), pid)
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	var body struct {
		BudgetCPUMilli  *int64 `json:"budget_cpu_milli"`
		BudgetMemBytes  *int64 `json:"budget_mem_bytes"`
		BudgetDiskBytes *int64 `json:"budget_disk_bytes"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if body.BudgetCPUMilli != nil {
		if *body.BudgetCPUMilli < 0 {
			writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
			return
		}
		p.BudgetCPUMilli = *body.BudgetCPUMilli
	}
	if body.BudgetMemBytes != nil {
		if *body.BudgetMemBytes < 0 {
			writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
			return
		}
		p.BudgetMemBytes = *body.BudgetMemBytes
	}
	if body.BudgetDiskBytes != nil {
		if *body.BudgetDiskBytes < 0 {
			writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
			return
		}
		p.BudgetDiskBytes = *body.BudgetDiskBytes
	}
	if err := s.App.Store.UpdateProject(r.Context(), p); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) reconcile(w http.ResponseWriter, r *http.Request) {
	if userFrom(r).PlatformRole != models.RolePlatformAdmin {
		writeErr(w, http.StatusForbidden, store.ErrForbidden)
		return
	}
	rel, stale, err := s.App.Reconcile(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"released": rel, "stale_nodes": stale})
}

func (s *Server) suspend(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if err := s.App.SuspendUser(r.Context(), *userFrom(r), id); err != nil {
		writeErr(w, http.StatusForbidden, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "suspended"})
}

func (s *Server) authorizedKeys(w http.ResponseWriter, r *http.Request) {
	want := os.Getenv("HA_INTERNAL_TOKEN")
	if want == "" || r.Header.Get("X-HA-Internal") != want {
		writeErr(w, http.StatusUnauthorized, store.ErrUnauthorized)
		return
	}
	user := r.URL.Query().Get("user")
	keys, err := s.App.AuthorizedKeys(r.Context(), user)
	if err != nil {
		// Empty key set → sshd denies; avoid leaking whether the user exists.
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		return
	}
	w.Header().Set("Content-Type", "text/plain")
	_, _ = w.Write([]byte(keys))
}

// internalSSHTarget is used by ha-bastion-proxy with X-HA-Internal.
// ACL is evaluated as the platform user named in ?user= (not a shared service JWT).
func (s *Server) internalSSHTarget(w http.ResponseWriter, r *http.Request) {
	want := os.Getenv("HA_INTERNAL_TOKEN")
	if want == "" || r.Header.Get("X-HA-Internal") != want {
		writeErr(w, http.StatusUnauthorized, store.ErrUnauthorized)
		return
	}
	username := strings.TrimSpace(r.URL.Query().Get("user"))
	id, err := uuid.Parse(r.URL.Query().Get("id"))
	if username == "" || err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	u, err := s.App.Store.GetUserByUsername(r.Context(), username)
	if err != nil || u.Status != models.UserActive {
		writeErr(w, http.StatusForbidden, store.ErrForbidden)
		return
	}
	ws, n, err := s.App.SSHTarget(r.Context(), *u, id)
	if err != nil {
		_ = s.App.Store.AddAudit(r.Context(), models.AuditLog{
			ActorUserID: u.ID, Action: "ssh.deny", ResourceType: "workspace",
			ResourceID: id.String(), IP: r.RemoteAddr,
			Meta: map[string]any{"reason": err.Error(), "via": "bastion"},
		})
		writeErr(w, http.StatusForbidden, err)
		return
	}
	_ = s.App.Store.AddAudit(r.Context(), models.AuditLog{
		ActorUserID: u.ID, Action: "ssh.allow", ResourceType: "workspace",
		ResourceID: ws.ID.String(), IP: r.RemoteAddr,
		Meta: map[string]any{"node": n.Name, "via": "bastion"},
	})
	writeSSHTarget(w, ws, n)
}
