package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"ha-cluster/internal/bastion"
	"ha-cluster/internal/models"
	"ha-cluster/internal/requestmeta"
	"ha-cluster/internal/store"
	"ha-cluster/internal/webshell"
)

func (s *Server) workspaceTerminal(w http.ResponseWriter, r *http.Request) {
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
	ws, node, err := s.App.SSHTarget(r.Context(), *actor, id)
	if err != nil {
		status := http.StatusForbidden
		if errors.Is(err, store.ErrNotFound) {
			status = http.StatusNotFound
		}
		writeErr(w, status, err)
		return
	}
	var mem *models.Membership
	if m, merr := s.App.Store.GetMembership(r.Context(), ws.ProjectID, actor.ID); merr == nil {
		mem = m
	}

	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
		CompressionMode:    websocket.CompressionDisabled,
	})
	if err != nil {
		return
	}
	defer c.Close(websocket.StatusNormalClosure, "")

	ctx := r.Context()
	ip := requestmeta.ClientIP(ctx)
	_ = s.App.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: actor.ID, Action: "ssh.session.open",
		ResourceType: "workspace", ResourceID: ws.ID.String(),
		IP:   ip,
		Meta: map[string]any{"via": "web-terminal"},
	})
	defer func() {
		_ = s.App.Store.AddAudit(context.Background(), models.AuditLog{
			ActorUserID: actor.ID, Action: "ssh.session.close",
			ResourceType: "workspace", ResourceID: ws.ID.String(),
			IP:   ip,
			Meta: map[string]any{"via": "web-terminal"},
		})
	}()

	if webshell.IsFake(s.App.Runtime) {
		webshell.PipeEcho(ctx, c, "已连接 "+ws.Name+"（开发模式模拟终端）\r\n")
		return
	}

	tg, err := bastion.Resolve(*ws, *node, *actor, mem)
	if err != nil {
		_ = c.Write(ctx, websocket.MessageText, []byte("无法解析 SSH 目标："+err.Error()))
		_ = c.Close(websocket.StatusTryAgainLater, "ssh target")
		return
	}
	_ = c.Write(ctx, websocket.MessageText, []byte("正在连接工作区…\r\n"))
	pubs := s.App.WorkspaceSSHKeys(ctx, *ws)
	if serr := s.App.Runtime.SyncKeys(ctx, ws.ID, pubs); serr != nil {
		_ = c.Write(ctx, websocket.MessageText, []byte("同步终端密钥失败："+serr.Error()+"\r\n"))
	}

	user := workspaceSSHUser()
	if err := webshell.DialAndPipe(ctx, c, user, tg.Host, tg.Port, webshell.Signer(), 120, 32); err != nil {
		_ = c.Write(ctx, websocket.MessageText, []byte("SSH 连接失败："+err.Error()+"\r\n"))
		time.Sleep(50 * time.Millisecond)
		_ = c.Close(websocket.StatusTryAgainLater, "ssh failed")
	}
}

func accessTokenFromRequest(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	}
	if strings.HasSuffix(r.URL.Path, "/terminal") {
		return strings.TrimSpace(r.URL.Query().Get("access_token"))
	}
	return ""
}
