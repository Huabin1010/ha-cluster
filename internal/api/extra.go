package api

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"ha-cluster/internal/auth"
	"ha-cluster/internal/models"
	"ha-cluster/internal/service"
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
	access, next, u, err := s.App.RefreshAccess(r.Context(), body.RefreshToken, auth.DeviceFingerprint(r))
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
	var body struct {
		Name            *string `json:"name"`
		Slug            *string `json:"slug"`
		BudgetCPUMilli  *int64  `json:"budget_cpu_milli"`
		BudgetMemBytes  *int64  `json:"budget_mem_bytes"`
		BudgetDiskBytes *int64  `json:"budget_disk_bytes"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	p, err := s.App.PatchProject(r.Context(), *userFrom(r), pid, service.PatchProjectInput{
		Name: body.Name, Slug: body.Slug,
		BudgetCPUMilli: body.BudgetCPUMilli, BudgetMemBytes: body.BudgetMemBytes, BudgetDiskBytes: body.BudgetDiskBytes,
	})
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, s.withMyRole(r.Context(), *userFrom(r), p))
}

func (s *Server) deleteProject(w http.ResponseWriter, r *http.Request) {
	pid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if err := s.App.DeleteProject(r.Context(), *userFrom(r), pid); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
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

func constantTimeEqual(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

func (s *Server) authorizedKeys(w http.ResponseWriter, r *http.Request) {
	want := os.Getenv("HA_INTERNAL_TOKEN")
	if !constantTimeEqual(r.Header.Get("X-HA-Internal"), want) {
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
	if !constantTimeEqual(r.Header.Get("X-HA-Internal"), want) {
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
	role := models.RoleDeveloper
	if m, err := s.App.Store.GetMembership(r.Context(), ws.ProjectID, u.ID); err == nil {
		role = m.Role
	}
	writeSSHTarget(w, ws, n, u, role)
}

func (s *Server) approveWorkspace(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	ws, err := s.App.ApproveWorkspace(r.Context(), *userFrom(r), id)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, ws)
}

func (s *Server) rejectWorkspace(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	_ = decodeJSON(r, &body)
	if err := s.App.RejectWorkspace(r.Context(), *userFrom(r), id, body.Reason); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "rejected"})
}

func (s *Server) sshConnection(w http.ResponseWriter, r *http.Request) {
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
	host := "bastion.mnnumath.vip"
	cmd := "ssh " + u.Username + "@" + host + " -p " + strconv.Itoa(port) + " -t " + ws.ID.String()
	scp := "scp -P " + strconv.Itoa(port) + " -o RequestTTY=force -o RemoteCommand=" + ws.ID.String() + " ./local-file " + u.Username + "@" + host + ":/root/"
	writeJSON(w, http.StatusOK, map[string]any{
		"host": host, "port": port, "user": u.Username,
		"workspace_id": ws.ID, "command": cmd, "scp_example": scp,
		"fingerprint": ws.HostKeyFP,
		"note":        "每台机器是独立隔离环境（独立进程/文件系统/网络）。添加自己的 SSH 公钥后即可连接跳板；可用 scp 上传文件，主机内已预装 Docker，允许自行拉取镜像。",
	})
}

func (s *Server) requestResize(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	var body struct {
		CPUMilli  int64 `json:"cpu_milli"`
		MemBytes  int64 `json:"mem_bytes"`
		DiskBytes int64 `json:"disk_bytes"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	ws, err := s.App.ApplyResizeImmediately(r.Context(), *userFrom(r), id, body.CPUMilli, body.MemBytes, body.DiskBytes)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, ws)
}

func (s *Server) approveResize(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	ws, err := s.App.ApproveResize(r.Context(), *userFrom(r), id)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, ws)
}

func (s *Server) rejectResize(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	_ = decodeJSON(r, &body)
	if err := s.App.RejectResize(r.Context(), *userFrom(r), id, body.Reason); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "resize_rejected"})
}

func (s *Server) ingressMeta(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, service.IngressPublicInfo())
}

func (s *Server) listIngress(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	items, err := s.App.ListIngress(r.Context(), *userFrom(r), id)
	if err != nil {
		writeErr(w, http.StatusForbidden, err)
		return
	}
	if items == nil {
		items = []models.IngressRoute{}
	}
	listEnvelope(w, items, len(items))
}

func (s *Server) createIngress(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	var body struct {
		Domain            string `json:"domain"`
		Path              string `json:"path"`
		Port              int    `json:"port"`
		Preset            string `json:"preset"`
		ExtraNginx        string `json:"extra_nginx"`
		ConfirmSecondPort bool   `json:"confirm_second_port"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	rt, err := s.App.CreateIngress(r.Context(), service.CreateIngressInput{
		WorkspaceID: id, Domain: body.Domain, Path: body.Path, Port: body.Port,
		Preset: body.Preset, ExtraNginx: body.ExtraNginx,
		ConfirmSecondPort: body.ConfirmSecondPort, Actor: *userFrom(r),
	})
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, rt)
}

func (s *Server) deleteIngress(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if err := s.App.DeleteIngress(r.Context(), *userFrom(r), id); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) approveIngress(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	rt, err := s.App.ApproveIngress(r.Context(), *userFrom(r), id)
	if err != nil {
		if errors.Is(err, store.ErrForbidden) {
			writeErr(w, http.StatusForbidden, err)
			return
		}
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, rt)
}

func (s *Server) rejectIngress(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	_ = decodeJSON(r, &body)
	rt, err := s.App.RejectIngress(r.Context(), *userFrom(r), id, body.Reason)
	if err != nil {
		if errors.Is(err, store.ErrForbidden) {
			writeErr(w, http.StatusForbidden, err)
			return
		}
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, rt)
}

func (s *Server) batchCreateUsers(w http.ResponseWriter, r *http.Request) {
	var body service.BatchCreateUsersInput
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if len(body.Users) == 0 {
		writeErr(w, http.StatusBadRequest, errors.New("EMPTY_USER_LIST"))
		return
	}
	if len(body.Users) > 200 {
		writeErr(w, http.StatusBadRequest, errors.New("MAX_200_USERS_PER_BATCH"))
		return
	}
	res, err := s.App.BatchCreateUsers(r.Context(), *userFrom(r), body)
	if err != nil {
		if errors.Is(err, store.ErrForbidden) {
			writeErr(w, http.StatusForbidden, err)
			return
		}
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

