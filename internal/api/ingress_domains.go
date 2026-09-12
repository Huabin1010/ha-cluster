package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"ha-cluster/internal/authz"
	"ha-cluster/internal/service"
	"ha-cluster/internal/store"
)

func (s *Server) listIngressDomains(w http.ResponseWriter, r *http.Request) {
	if !authz.IsPlatformAdmin(*userFrom(r)) {
		writeErr(w, http.StatusForbidden, store.ErrForbidden)
		return
	}
	items, err := s.App.ListIngressDomainZonesAdmin(r.Context(), *userFrom(r))
	if err != nil {
		writeAPIErr(w, err)
		return
	}
	listEnvelope(w, items, len(items))
}

func (s *Server) createIngressDomain(w http.ResponseWriter, r *http.Request) {
	if !authz.IsPlatformAdmin(*userFrom(r)) {
		writeErr(w, http.StatusForbidden, store.ErrForbidden)
		return
	}
	var body struct {
		Suffix            string `json:"suffix"`
		DisplayName       string `json:"display_name"`
		RequireApproval   bool   `json:"require_approval"`
		Enabled           *bool  `json:"enabled"`
		AllowRandom       *bool  `json:"allow_random"`
		AllowCustomPrefix *bool  `json:"allow_custom_prefix"`
		SortOrder         int    `json:"sort_order"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	enabled := true
	if body.Enabled != nil {
		enabled = *body.Enabled
	}
	allowRandom := true
	if body.AllowRandom != nil {
		allowRandom = *body.AllowRandom
	}
	allowCustom := true
	if body.AllowCustomPrefix != nil {
		allowCustom = *body.AllowCustomPrefix
	}
	z, err := s.App.CreateIngressDomainZone(r.Context(), service.CreateIngressDomainZoneInput{
		Suffix: body.Suffix, DisplayName: body.DisplayName,
		RequireApproval: body.RequireApproval, Enabled: enabled,
		AllowRandom: allowRandom, AllowCustomPrefix: allowCustom,
		SortOrder: body.SortOrder, Actor: *userFrom(r),
	})
	if err != nil {
		writeAPIErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, z)
}

func (s *Server) patchIngressDomain(w http.ResponseWriter, r *http.Request) {
	if !authz.IsPlatformAdmin(*userFrom(r)) {
		writeErr(w, http.StatusForbidden, store.ErrForbidden)
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	var body struct {
		Suffix            *string `json:"suffix"`
		DisplayName       *string `json:"display_name"`
		RequireApproval   *bool   `json:"require_approval"`
		Enabled           *bool   `json:"enabled"`
		AllowRandom       *bool   `json:"allow_random"`
		AllowCustomPrefix *bool   `json:"allow_custom_prefix"`
		SortOrder         *int    `json:"sort_order"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	z, err := s.App.PatchIngressDomainZone(r.Context(), id, service.PatchIngressDomainZoneInput{
		Suffix: body.Suffix, DisplayName: body.DisplayName,
		RequireApproval: body.RequireApproval, Enabled: body.Enabled,
		AllowRandom: body.AllowRandom, AllowCustomPrefix: body.AllowCustomPrefix,
		SortOrder: body.SortOrder, Actor: *userFrom(r),
	})
	if err != nil {
		writeAPIErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, z)
}

func (s *Server) deleteIngressDomain(w http.ResponseWriter, r *http.Request) {
	if !authz.IsPlatformAdmin(*userFrom(r)) {
		writeErr(w, http.StatusForbidden, store.ErrForbidden)
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if err := s.App.DeleteIngressDomainZone(r.Context(), *userFrom(r), id); err != nil {
		writeAPIErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) claimSharedIngress(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	var body struct {
		ZoneID            string `json:"zone_id"`
		Mode              string `json:"mode"`
		Prefix            string `json:"prefix"`
		Port              int    `json:"port"`
		Preset            string `json:"preset"`
		ExtraNginx        string `json:"extra_nginx"`
		ConfirmSecondPort bool   `json:"confirm_second_port"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	zid, err := uuid.Parse(strings.TrimSpace(body.ZoneID))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	rt, err := s.App.ClaimSharedIngress(r.Context(), service.ClaimSharedIngressInput{
		WorkspaceID: id, ZoneID: zid, Mode: body.Mode, Prefix: body.Prefix,
		Port: body.Port, Preset: body.Preset, ExtraNginx: body.ExtraNginx,
		ConfirmSecondPort: body.ConfirmSecondPort, Actor: *userFrom(r),
	})
	if err != nil {
		if errors.Is(err, store.ErrForbidden) {
			writeErr(w, http.StatusForbidden, err)
			return
		}
		if errors.Is(err, store.ErrConflict) {
			writeErr(w, http.StatusConflict, err)
			return
		}
		if errors.Is(err, store.ErrSecondPort) {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, rt)
}
