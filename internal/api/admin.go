package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

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
	status := models.WSDestroyRequested
	if ws, err := s.App.Store.GetWorkspace(r.Context(), id); err == nil {
		status = ws.Status
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": status})
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
		UseLANDepot bool   `json:"use_lan_depot"`
	}
	if r.Body != nil {
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&body); err != nil && !errors.Is(err, io.EOF) {
			writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
			return
		}
	}
	out, err := service.IssueJoinToken(service.JoinTokenInput{
		Cluster: body.Cluster, Secret: body.Secret,
		API: body.API, DepotPublic: body.DepotPublic,
		UseLANDepot: body.UseLANDepot,
	})
	if err != nil {
		writeAPIErr(w, err)
		return
	}
	_ = s.App.Store.AddAudit(r.Context(), models.AuditLog{
		ActorUserID: userFrom(r).ID, Action: "node.join_token_issued",
		ResourceType: "cluster", ResourceID: out.Cluster,
		Meta: map[string]any{"api": out.API, "depot_public": out.DepotPublic},
	})
	writeJSON(w, http.StatusOK, out)
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
