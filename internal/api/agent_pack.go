package api

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"ha-cluster/internal/agentpack"
	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

func requestAPIBase(r *http.Request) string {
	return agentpack.ResolveAPIBase(r.Host, r.Header.Get("X-Forwarded-Proto"), r.TLS != nil)
}

func (s *Server) meAgentPack(w http.ResponseWriter, r *http.Request) {
	rotate := false
	if r.Method == http.MethodPost {
		var body struct {
			Rotate bool `json:"rotate"`
		}
		_ = decodeJSON(r, &body)
		rotate = body.Rotate
	}
	u := userFrom(r)
	rec, created, err := s.App.EnsureAgentToken(r.Context(), *u, rotate)
	if err != nil {
		writeAPIErr(w, err)
		return
	}
	apiBase := requestAPIBase(r)
	url := agentpack.PackURL(apiBase, rec.Token)
	v := agentpack.Vars{
		APIBase:      apiBase,
		ConsoleURL:   agentpack.ConsoleURL(),
		Token:        rec.Token,
		Username:     u.Username,
		UserID:       u.ID.String(),
		PlatformRole: u.PlatformRole,
		PackURL:      url,
	}
	code := http.StatusOK
	if created {
		code = http.StatusCreated
	}
	writeJSON(w, code, map[string]any{
		"url":        url,
		"prompt":     agentpack.InstallPrompt(v),
		"prefix":     rec.Prefix,
		"created_at": rec.CreatedAt,
		"rotated":    rotate && created,
	})
}

func (s *Server) publicAgentPack(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimSpace(chi.URLParam(r, "token"))
	raw = strings.TrimSuffix(raw, ".md")
	if !strings.HasPrefix(raw, models.AgentTokenPrefix) {
		writeErr(w, http.StatusNotFound, store.ErrNotFound)
		return
	}
	u, rec, err := s.App.LookupAgentUser(r.Context(), raw)
	if err != nil {
		writeErr(w, http.StatusNotFound, store.ErrNotFound)
		return
	}
	pack := s.App.BuildAgentPack(*u, rec, requestAPIBase(r))
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Robots-Tag", "noindex")
	format := strings.ToLower(r.URL.Query().Get("format"))
	accept := r.Header.Get("Accept")
	if format == "md" || format == "markdown" || strings.Contains(accept, "text/markdown") {
		w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(agentpack.Markdown(pack)))
		return
	}
	writeJSON(w, http.StatusOK, pack)
}
