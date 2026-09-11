package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"ha-cluster/internal/authz"
	"ha-cluster/internal/models"
	"ha-cluster/internal/service"
	"ha-cluster/internal/store"
)

func (s *Server) listDockerRegistries(w http.ResponseWriter, r *http.Request) {
	if !authz.IsPlatformAdmin(*userFrom(r)) {
		writeErr(w, http.StatusForbidden, store.ErrForbidden)
		return
	}
	items, err := s.App.ListDockerRegistries(r.Context(), *userFrom(r))
	if err != nil {
		writeAPIErr(w, err)
		return
	}
	listEnvelope(w, items, len(items))
}

func (s *Server) createDockerRegistry(w http.ResponseWriter, r *http.Request) {
	if !authz.IsPlatformAdmin(*userFrom(r)) {
		writeErr(w, http.StatusForbidden, store.ErrForbidden)
		return
	}
	var body struct {
		Name       string `json:"name"`
		Server     string `json:"server"`
		Username   string `json:"username"`
		Password   string `json:"password"`
		AutoInject bool   `json:"auto_inject"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if body.Password == "" {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	pub, err := s.App.CreateDockerRegistry(r.Context(), *userFrom(r), models.DockerRegistry{
		Name: body.Name, Server: body.Server, Username: body.Username, AutoInject: body.AutoInject,
	}, body.Password)
	if err != nil {
		writeAPIErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, pub)
}

func (s *Server) patchDockerRegistry(w http.ResponseWriter, r *http.Request) {
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
		Name       *string `json:"name"`
		Server     *string `json:"server"`
		Username   *string `json:"username"`
		Password   *string `json:"password"`
		AutoInject *bool   `json:"auto_inject"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	pub, err := s.App.UpdateDockerRegistry(r.Context(), *userFrom(r), id, service.DockerRegistryPatch{
		Name: body.Name, Server: body.Server, Username: body.Username,
		Password: body.Password, AutoInject: body.AutoInject,
	})
	if err != nil {
		writeAPIErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, pub)
}

func (s *Server) deleteDockerRegistry(w http.ResponseWriter, r *http.Request) {
	if !authz.IsPlatformAdmin(*userFrom(r)) {
		writeErr(w, http.StatusForbidden, store.ErrForbidden)
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if err := s.App.DeleteDockerRegistry(r.Context(), *userFrom(r), id); err != nil {
		writeAPIErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) testDockerRegistry(w http.ResponseWriter, r *http.Request) {
	if !authz.IsPlatformAdmin(*userFrom(r)) {
		writeErr(w, http.StatusForbidden, store.ErrForbidden)
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if err := s.App.TestDockerRegistry(r.Context(), *userFrom(r), id); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) testDockerRegistryRaw(w http.ResponseWriter, r *http.Request) {
	if !authz.IsPlatformAdmin(*userFrom(r)) {
		writeErr(w, http.StatusForbidden, store.ErrForbidden)
		return
	}
	var body struct {
		Server   string `json:"server"`
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	if err := s.App.TestDockerRegistryInput(body.Server, body.Username, body.Password); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
