package api

import (
	"fmt"
	"net/http"
	"net/url"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"ha-cluster/internal/authz"
	"ha-cluster/internal/models"
	"ha-cluster/internal/service"
	"ha-cluster/internal/store"
)

func (s *Server) requirePlatformStaff(w http.ResponseWriter, r *http.Request) bool {
	if !authz.IsPlatformStaff(*userFrom(r)) {
		writeErr(w, http.StatusForbidden, store.ErrForbidden)
		return false
	}
	return true
}

func (s *Server) transferOwnership(w http.ResponseWriter, r *http.Request) {
	pid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	var body struct {
		NewOwnerUserID string `json:"new_owner_user_id"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	uid, err := uuid.Parse(body.NewOwnerUserID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if err := s.App.TransferOwnership(r.Context(), *userFrom(r), pid, uid); err != nil {
		writeAPIErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "transferred"})
}

func (s *Server) requestSSHAccess(w http.ResponseWriter, r *http.Request) {
	pid, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	m, err := s.App.RequestSSHAccess(r.Context(), *userFrom(r), pid)
	if err != nil {
		writeAPIErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (s *Server) approveSSHAccess(w http.ResponseWriter, r *http.Request) {
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
	m, err := s.App.ApproveSSHAccess(r.Context(), *userFrom(r), pid, uid)
	if err != nil {
		writeAPIErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (s *Server) patchMember(w http.ResponseWriter, r *http.Request) {
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
	var body struct {
		Role      *string `json:"role"`
		SSHAccess *string `json:"ssh_access"`
		SSHMode   *string `json:"ssh_mode"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	m, err := s.App.PatchMember(r.Context(), *userFrom(r), pid, uid, service.PatchMemberInput{
		Role: body.Role, SSHAccess: body.SSHAccess, SSHMode: body.SSHMode,
	})
	if err != nil {
		writeAPIErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (s *Server) requestDestroy(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if err := s.App.RequestDestroyWorkspace(r.Context(), *userFrom(r), id); err != nil {
		writeAPIErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": models.WSDestroyRequested})
}

func (s *Server) approveDestroyProject(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if err := s.App.ApproveDestroyProject(r.Context(), *userFrom(r), id); err != nil {
		writeAPIErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "approved_project"})
}

func (s *Server) approveDestroyPlatform(w http.ResponseWriter, r *http.Request) {
	if !authz.CanApproveDangerousOps(*userFrom(r)) {
		writeErr(w, http.StatusForbidden, store.ErrForbidden)
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if err := s.App.ApproveDestroyPlatform(r.Context(), *userFrom(r), id); err != nil {
		writeAPIErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": models.WSDestroyed})
}

func (s *Server) listDangerousApprovals(w http.ResponseWriter, r *http.Request) {
	if !authz.CanApproveDangerousOps(*userFrom(r)) {
		writeErr(w, http.StatusForbidden, store.ErrForbidden)
		return
	}
	items, err := s.App.ListDangerousDestroyPending(r.Context(), *userFrom(r))
	if err != nil {
		writeAPIErr(w, err)
		return
	}
	listEnvelope(w, items, len(items))
}

func (s *Server) generateJoinToken(w http.ResponseWriter, r *http.Request) {
	if !authz.IsPlatformAdmin(*userFrom(r)) {
		writeErr(w, http.StatusForbidden, store.ErrForbidden)
		return
	}
	var body struct {
		Cluster     string `json:"cluster"`
		Secret      string `json:"secret"`
		API         string `json:"api"`
		DepotPublic string `json:"depot_public"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if body.Cluster == "" || body.Secret == "" {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if body.API == "" {
		body.API = "https://ha.mnnumath.vip/api"
	}
	if body.DepotPublic == "" {
		body.DepotPublic = "https://rustfs.s.ggss.club:50000/typora/ha-cluster"
	}
	q := url.Values{}
	q.Set("et_net", "ha-cluster-easytier")
	q.Set("et_peer", "tcp://110.40.229.62:15010")
	q.Set("api", body.API)
	q.Set("depot_public", body.DepotPublic)
	token := fmt.Sprintf("ha://join/%s/%s?%s", body.Cluster, body.Secret, q.Encode())
	_ = s.App.Store.AddAudit(r.Context(), models.AuditLog{
		ActorUserID: userFrom(r).ID, Action: "node.join_token_issued",
		ResourceType: "cluster", ResourceID: body.Cluster,
	})
	writeJSON(w, http.StatusOK, map[string]string{"token": token})
}

func (s *Server) patchNode(w http.ResponseWriter, r *http.Request) {
	if !s.requirePlatformStaff(w, r) {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	var body struct {
		MachineType string   `json:"machine_type"`
		Remark      string   `json:"remark"`
		Tags        []string `json:"tags"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if body.MachineType != "" && !models.ValidMachineType(body.MachineType) {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	tags := models.NormalizeNodeTags(body.Tags)
	if err := s.App.Store.UpdateNodeMeta(r.Context(), id, body.MachineType, body.Remark, tags); err != nil {
		writeAPIErr(w, err)
		return
	}
	n, err := s.App.Store.GetNode(r.Context(), id)
	if err != nil {
		writeAPIErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, n)
}

func writeAPIErr(w http.ResponseWriter, err error) {
	if err == nil {
		return
	}
	code := http.StatusBadRequest
	if err == store.ErrNotFound {
		code = http.StatusNotFound
	} else if err == store.ErrForbidden {
		code = http.StatusForbidden
	} else if err == store.ErrConflict {
		code = http.StatusConflict
	}
	writeErr(w, code, err)
}
