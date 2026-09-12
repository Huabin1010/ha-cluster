package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"ha-cluster/internal/authz"
	"ha-cluster/internal/store"
)

func (s *Server) listTLSCerts(w http.ResponseWriter, r *http.Request) {
	if !authz.IsPlatformAdmin(*userFrom(r)) {
		writeErr(w, http.StatusForbidden, store.ErrForbidden)
		return
	}
	items, err := s.App.ListTLSCerts(r.Context(), *userFrom(r))
	if err != nil {
		writeAPIErr(w, err)
		return
	}
	listEnvelope(w, items, len(items))
}

func (s *Server) issueTLSCert(w http.ResponseWriter, r *http.Request) {
	if !authz.IsPlatformAdmin(*userFrom(r)) {
		writeErr(w, http.StatusForbidden, store.ErrForbidden)
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	c, err := s.App.IssueTLSCert(r.Context(), *userFrom(r), id)
	if err != nil {
		if c != nil {
			writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error(), "cert": c})
			return
		}
		writeAPIErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) patchTLSCert(w http.ResponseWriter, r *http.Request) {
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
		AutoRenew *bool `json:"auto_renew"`
	}
	if err := decodeJSON(r, &body); err != nil || body.AutoRenew == nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	c, err := s.App.SetTLSAutoRenew(r.Context(), *userFrom(r), id, *body.AutoRenew)
	if err != nil {
		writeAPIErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}
