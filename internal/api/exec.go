package api

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"ha-cluster/internal/authz"
	"ha-cluster/internal/bastion"
	"ha-cluster/internal/models"
	"ha-cluster/internal/requestmeta"
	"ha-cluster/internal/store"
	"ha-cluster/internal/webshell"
)

const (
	maxExecCommandRunes = 32 << 10
	maxExecStdinBytes   = 8 << 20
	maxExecJSONBytes    = 12 << 20
)

func (s *Server) execWorkspace(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	actor := userFrom(r)
	if actor == nil {
		writeErr(w, http.StatusUnauthorized, store.ErrUnauthorized)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxExecJSONBytes)
	var body struct {
		Command    string `json:"command"`
		StdinB64   string `json:"stdin_b64"`
		TimeoutSec int    `json:"timeout_sec"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, store.ErrInvalidInput)
		return
	}
	command := strings.TrimSpace(body.Command)
	if command == "" {
		writeErr(w, http.StatusBadRequest, errors.New("command 不能为空"))
		return
	}
	if utf8.RuneCountInString(command) > maxExecCommandRunes {
		writeErr(w, http.StatusBadRequest, errors.New("command 过长"))
		return
	}

	var stdin []byte
	if raw := strings.TrimSpace(body.StdinB64); raw != "" {
		stdin, err = base64.StdEncoding.DecodeString(raw)
		if err != nil {
			writeErr(w, http.StatusBadRequest, errors.New("stdin_b64 不是合法 base64"))
			return
		}
		if len(stdin) > maxExecStdinBytes {
			writeErr(w, http.StatusBadRequest, errors.New("stdin 过大"))
			return
		}
	}

	timeout := webshell.DefaultExecTimeout
	if body.TimeoutSec > 0 {
		timeout = time.Duration(body.TimeoutSec) * time.Second
		if timeout > webshell.MaxExecTimeout {
			timeout = webshell.MaxExecTimeout
		}
	}

	ws, node, err := s.App.SSHTarget(r.Context(), *actor, id)
	if err != nil {
		status := http.StatusForbidden
		if errors.Is(err, store.ErrNotFound) {
			status = http.StatusNotFound
		} else if errors.Is(err, store.ErrInvalidInput) {
			status = http.StatusBadRequest
		}
		writeErr(w, status, err)
		return
	}
	var mem *models.Membership
	if m, merr := s.App.Store.GetMembership(r.Context(), ws.ProjectID, actor.ID); merr == nil {
		mem = m
		models.NormalizeMembershipSSH(mem)
		if mem.SSHMode == models.SSHModeReadOnly && !authz.IsPlatformAdmin(*actor) {
			writeErr(w, http.StatusForbidden, errors.New("只读 SSH 不能通过 HTTP 执行命令"))
			return
		}
	}

	ip := requestmeta.ClientIP(r.Context())
	cmdPreview := command
	if utf8.RuneCountInString(cmdPreview) > 200 {
		cmdPreview = string([]rune(cmdPreview)[:200]) + "…"
	}

	if webshell.IsFake(s.App.Runtime) {
		stdout, stderr, exit := webshell.FakeRun(command, stdin)
		_ = s.App.Store.AddAudit(r.Context(), models.AuditLog{
			ActorUserID: actor.ID, Action: "ssh.exec",
			ResourceType: "workspace", ResourceID: ws.ID.String(),
			IP: ip,
			Meta: map[string]any{
				"via": "http-ssh", "fake": true, "command": cmdPreview,
				"exit_code": exit, "username": actor.Username,
			},
		})
		writeJSON(w, http.StatusOK, execResponse(stdout, stderr, exit, "http-ssh"))
		return
	}

	tg, err := bastion.Resolve(*ws, *node, *actor, mem)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	pubs := s.App.WorkspaceSSHKeys(r.Context(), *ws)
	if serr := s.App.Runtime.SyncKeys(r.Context(), ws.ID, pubs); serr != nil {
		writeErr(w, http.StatusBadGateway, fmt.Errorf("同步终端密钥失败：%w", serr))
		return
	}

	stdout, stderr, exit, err := webshell.RunCommand(
		r.Context(), workspaceSSHUser(), tg.Host, tg.Port, webshell.Signer(), command, stdin, timeout,
	)
	if err != nil {
		_ = s.App.Store.AddAudit(r.Context(), models.AuditLog{
			ActorUserID: actor.ID, Action: "ssh.exec.deny",
			ResourceType: "workspace", ResourceID: ws.ID.String(),
			IP: ip,
			Meta: map[string]any{
				"via": "http-ssh", "command": cmdPreview, "error": err.Error(),
				"username": actor.Username, "target": tg.Host,
			},
		})
		writeErr(w, http.StatusBadGateway, fmt.Errorf("SSH 执行失败：%w", err))
		return
	}
	_ = s.App.Store.AddAudit(r.Context(), models.AuditLog{
		ActorUserID: actor.ID, Action: "ssh.exec",
		ResourceType: "workspace", ResourceID: ws.ID.String(),
		IP: ip,
		Meta: map[string]any{
			"via": "http-ssh", "command": cmdPreview, "exit_code": exit,
			"username": actor.Username, "target": tg.Host,
		},
	})
	writeJSON(w, http.StatusOK, execResponse(stdout, stderr, exit, "http-ssh"))
}

func execResponse(stdout, stderr []byte, exit int, via string) map[string]any {
	return map[string]any{
		"exit_code": exit,
		"stdout":    string(stdout),
		"stderr":    string(stderr),
		"via":       via,
	}
}

func execExample(apiBase string, workspaceID uuid.UUID) string {
	base := strings.TrimRight(strings.TrimSpace(apiBase), "/")
	if base == "" {
		base = "https://cl.qzsyzn.com/api"
	}
	return `curl -fsS -H "Authorization: Bearer <令牌>" -H "Content-Type: application/json" -d "{\"command\":\"uname -a\"}" ` +
		base + "/workspaces/" + workspaceID.String() + "/exec"
}
