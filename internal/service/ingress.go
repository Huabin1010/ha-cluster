package service

import (
	"context"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/ingress"
	hak8s "ha-cluster/internal/k8s"
	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

func PublicIngressHost() string {
	if v := strings.TrimSpace(os.Getenv("HA_INGRESS_PUBLIC_HOST")); v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv("HA_INGRESS_PUBLIC_IP")); v != "" {
		return v
	}
	return "106.52.109.127"
}

// FabricEdgeHost is the EasyTier VIP of the control/edge peer (42).
// ET-joined clients should resolve *.cl.qzsyzn.com here so HTTPS/HTTP
// stays on the overlay and does not consume the 42 public NIC.
func FabricEdgeHost() string {
	if v := strings.TrimSpace(os.Getenv("HA_FABRIC_EDGE_HOST")); v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv("HA_BASTION_FABRIC_HOST")); v != "" {
		return v
	}
	return "10.129.129.253"
}

func FabricHTTPPort() int {
	if v := strings.TrimSpace(os.Getenv("HA_EDGE_PORT")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return 18080
}

type CreateIngressInput struct {
	WorkspaceID       uuid.UUID
	Domain            string
	ZoneID            *uuid.UUID
	Prefix            string
	Path              string
	Port              int
	Preset            string
	ExtraNginx        string
	ConfirmSecondPort bool
	Actor             models.User
}

type createRouteParams struct {
	WS                *models.Workspace
	Domain            string
	Path              string
	Port              int
	Preset            string
	ExtraNginx        string
	ConfirmSecondPort bool
	Actor             models.User
	Status            string
	DomainTier        string
	ZoneID            *uuid.UUID
	Prefix            string
	AutoReview        bool
}

func (a *App) exposeWorkspacePort(ctx context.Context, w *models.Workspace, routeID uuid.UUID, port int) (int, error) {
	if w != nil && models.IsK8sRuntime(w.Runtime) {
		if a.K8s == nil {
			return 0, hak8s.ErrUnavailable
		}
		return a.K8s.ServiceNodePort(ctx, w.RuntimeRef, port)
	}
	if w == nil {
		return 0, store.ErrNotFound
	}
	return a.Runtime.ExposePort(ctx, w.ID, routeID, port)
}

func (a *App) annotateRoute(ctx context.Context, r *models.IngressRoute) {
	up := a.upstreamFor(ctx, r)
	r.NginxPreview = ingress.Render(ingress.RenderInput{Route: *r, Upstream: up})
	r.DNSHint = "将域名 " + r.Domain + " 的 A 记录解析到 " + PublicIngressHost() + "（平台公网入口），TTL 可先设 60 秒。"
}

func (a *App) upstreamFor(ctx context.Context, r *models.IngressRoute) string {
	ws, err := a.Store.GetWorkspace(ctx, r.WorkspaceID)
	if err != nil {
		return ""
	}
	host := ""
	if n, err := a.Store.GetNode(ctx, ws.NodeID); err == nil {
		host = strings.TrimSpace(n.FabricIP)
		if host == "" {
			host = strings.TrimSpace(n.LanIP)
		}
	}
	if host == "" {
		return ""
	}
	port := r.HostPort
	if port <= 0 {
		port = r.Port
	}
	return net.JoinHostPort(host, strconv.Itoa(port))
}

func (a *App) rewriteIngress(ctx context.Context) {
	dir := strings.TrimSpace(os.Getenv("HA_INGRESS_DIR"))
	if dir == "" {
		return
	}
	routes, err := a.Store.ListIngress(ctx, nil)
	if err != nil {
		return
	}
	files := map[string]string{}
	for i := range routes {
		if routes[i].Status != models.IngressActive {
			continue
		}
		up := a.upstreamFor(ctx, &routes[i])
		name := routes[i].ID.String() + ".conf"
		files[name] = ingress.Render(ingress.RenderInput{Route: routes[i], Upstream: up})
	}
	_ = ingress.WriteAll(dir, files)
	_ = ingress.Reload(os.Getenv("HA_INGRESS_RELOAD"))
}

func (a *App) ListIngress(ctx context.Context, actor models.User, workspaceID uuid.UUID) ([]models.IngressRoute, error) {
	ws, err := a.Store.GetWorkspace(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	if _, err := a.RequireMembership(ctx, actor, ws.ProjectID, models.RoleViewer); err != nil {
		return nil, err
	}
	items, err := a.Store.ListIngress(ctx, &workspaceID)
	if err != nil {
		return nil, err
	}
	for i := range items {
		a.annotateRoute(ctx, &items[i])
	}
	return items, nil
}

func (a *App) CreateIngress(ctx context.Context, in CreateIngressInput) (*models.IngressRoute, error) {
	ws, err := a.Store.GetWorkspace(ctx, in.WorkspaceID)
	if err != nil {
		return nil, err
	}
	mem, err := a.RequireProjectReady(ctx, in.Actor, ws.ProjectID, models.RoleDeveloper)
	if err != nil {
		return nil, err
	}
	if ws.Status != models.WSRunning && ws.Status != models.WSDegraded {
		return nil, store.ErrInvalidInput
	}

	var domain, prefix string
	var zoneID *uuid.UUID
	tier := models.IngressTierCustom

	if in.ZoneID != nil && *in.ZoneID != uuid.Nil {
		z, err := a.Store.GetIngressDomainZone(ctx, *in.ZoneID)
		if err != nil {
			return nil, err
		}
		if !z.Enabled || !z.RequireApproval {
			return nil, store.ErrInvalidInput
		}
		prefix = strings.ToLower(strings.TrimSpace(in.Prefix))
		if !ingress.ValidPrefix(prefix) || ingress.IsPrefixReserved(prefix) {
			return nil, store.ErrInvalidInput
		}
		domain = prefix + "." + z.Suffix
		zoneID = &z.ID
		tier = models.IngressTierShared
	} else {
		domain = strings.ToLower(strings.TrimSpace(in.Domain))
		if !ingress.ValidDomain(domain) || ingress.IsSubdomainReserved(domain) {
			return nil, store.ErrInvalidInput
		}
		hit, err := a.domainMatchesConfiguredZone(ctx, domain)
		if err != nil {
			return nil, err
		}
		if hit {
			return nil, store.ErrInvalidInput
		}
	}

	status := models.IngressPendingApproval
	autoReview := false
	if canBypassIngressApproval(*mem, in.Actor) {
		status = models.IngressActive
		autoReview = true
	}

	return a.createIngressRoute(ctx, createRouteParams{
		WS: ws, Domain: domain, Path: in.Path, Port: in.Port, Preset: in.Preset,
		ExtraNginx: in.ExtraNginx, ConfirmSecondPort: in.ConfirmSecondPort,
		Actor: in.Actor, Status: status, DomainTier: tier, ZoneID: zoneID, Prefix: prefix,
		AutoReview: autoReview,
	})
}

func (a *App) createIngressRoute(ctx context.Context, in createRouteParams) (*models.IngressRoute, error) {
	if !ingress.ValidDomain(in.Domain) || ingress.IsSubdomainReserved(in.Domain) {
		return nil, store.ErrInvalidInput
	}
	if in.Port < 1 || in.Port > 65535 {
		return nil, store.ErrInvalidInput
	}
	preset := strings.TrimSpace(in.Preset)
	if preset == "" {
		preset = models.IngressNocache
	}
	if !ingress.ValidPreset(preset) {
		return nil, store.ErrInvalidInput
	}
	extra, err := ingress.SanitizeExtra(in.ExtraNginx)
	if err != nil {
		return nil, store.ErrInvalidInput
	}
	existing, err := a.Store.ListIngress(ctx, &in.WS.ID)
	if err != nil {
		return nil, err
	}
	ports := map[int]struct{}{}
	for _, e := range existing {
		ports[e.Port] = struct{}{}
	}
	if _, same := ports[in.Port]; !same && len(ports) >= 1 && !in.ConfirmSecondPort {
		return nil, store.ErrSecondPort
	}

	var reviewedBy *uuid.UUID
	var reviewedAt *time.Time
	if in.AutoReview {
		reviewedBy = &in.Actor.ID
		now := time.Now()
		reviewedAt = &now
	}
	tier := in.DomainTier
	if tier == "" {
		tier = models.IngressTierCustom
	}

	r := &models.IngressRoute{
		ID: uuid.New(), WorkspaceID: in.WS.ID, ProjectID: in.WS.ProjectID,
		Domain: in.Domain, Path: ingress.NormalizePath(in.Path), Port: in.Port,
		Preset: preset, ExtraNginx: extra, Status: in.Status,
		DomainTier: tier, ZoneID: in.ZoneID, Prefix: in.Prefix,
		ApplicantUserID: in.Actor.ID,
		ReviewedBy:      reviewedBy,
		ReviewedAt:      reviewedAt,
		CreatedAt:       time.Now(),
	}
	if err := a.Store.CreateIngress(ctx, r); err != nil {
		return nil, err
	}
	if in.Status == models.IngressActive {
		if hp, err := a.exposeWorkspacePort(ctx, in.WS, r.ID, r.Port); err == nil && hp > 0 {
			r.HostPort = hp
			_ = a.Store.UpdateIngress(ctx, r)
		}
		a.rewriteIngress(ctx)
	}
	a.annotateRoute(ctx, r)
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: in.Actor.ID, Action: "ingress.create",
		ResourceType: "ingress", ResourceID: r.ID.String(),
		Meta: map[string]any{
			"domain": in.Domain, "port": in.Port, "workspace": in.WS.ID.String(),
			"status": in.Status, "domain_tier": tier, "prefix": in.Prefix,
		},
	})
	return r, nil
}

func (a *App) ApproveIngress(ctx context.Context, actor models.User, id uuid.UUID) (*models.IngressRoute, error) {
	r, err := a.Store.GetIngress(ctx, id)
	if err != nil {
		return nil, err
	}
	if _, err := a.RequireProjectReady(ctx, actor, r.ProjectID, models.RoleAdmin); err != nil {
		return nil, err
	}
	if r.Status != models.IngressPendingApproval && r.Status != models.IngressRejected {
		return nil, store.ErrInvalidInput
	}
	if ws, werr := a.Store.GetWorkspace(ctx, r.WorkspaceID); werr == nil {
		if hp, err := a.exposeWorkspacePort(ctx, ws, r.ID, r.Port); err == nil && hp > 0 {
			r.HostPort = hp
		}
	}
	r.Status = models.IngressActive
	r.ReviewedBy = &actor.ID
	now := time.Now()
	r.ReviewedAt = &now
	r.RejectReason = ""
	if err := a.Store.UpdateIngress(ctx, r); err != nil {
		return nil, err
	}
	a.rewriteIngress(ctx)
	a.annotateRoute(ctx, r)
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: actor.ID, Action: "ingress.approve",
		ResourceType: "ingress", ResourceID: r.ID.String(),
		Meta: map[string]any{"domain": r.Domain},
	})
	return r, nil
}

func (a *App) RejectIngress(ctx context.Context, actor models.User, id uuid.UUID, reason string) (*models.IngressRoute, error) {
	r, err := a.Store.GetIngress(ctx, id)
	if err != nil {
		return nil, err
	}
	if _, err := a.RequireProjectReady(ctx, actor, r.ProjectID, models.RoleAdmin); err != nil {
		return nil, err
	}
	if r.Status == models.IngressRejected {
		return r, nil
	}
	wasActive := r.Status == models.IngressActive
	if wasActive {
		_ = a.Runtime.UnexposePort(ctx, r.WorkspaceID, r.ID)
	}
	r.Status = models.IngressRejected
	r.ReviewedBy = &actor.ID
	now := time.Now()
	r.ReviewedAt = &now
	r.RejectReason = strings.TrimSpace(reason)
	if err := a.Store.UpdateIngress(ctx, r); err != nil {
		return nil, err
	}
	if wasActive {
		a.rewriteIngress(ctx)
	}
	a.annotateRoute(ctx, r)
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: actor.ID, Action: "ingress.reject",
		ResourceType: "ingress", ResourceID: r.ID.String(),
		Meta: map[string]any{"domain": r.Domain, "reason": r.RejectReason},
	})
	return r, nil
}

func (a *App) DeleteIngress(ctx context.Context, actor models.User, id uuid.UUID) error {
	r, err := a.Store.GetIngress(ctx, id)
	if err != nil {
		return err
	}
	if _, err := a.RequireProjectReady(ctx, actor, r.ProjectID, models.RoleDeveloper); err != nil {
		return err
	}
	if r.Status == models.IngressActive {
		_ = a.Runtime.UnexposePort(ctx, r.WorkspaceID, r.ID)
	}
	if err := a.Store.DeleteIngress(ctx, id); err != nil {
		return err
	}
	a.rewriteIngress(ctx)
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: actor.ID, Action: "ingress.delete",
		ResourceType: "ingress", ResourceID: id.String(),
		Meta: map[string]any{"domain": r.Domain},
	})
	return nil
}

func (a *App) dropWorkspaceIngress(ctx context.Context, workspaceID uuid.UUID) {
	items, err := a.Store.ListIngress(ctx, &workspaceID)
	if err != nil {
		return
	}
	for _, r := range items {
		if r.Status == models.IngressActive {
			_ = a.Runtime.UnexposePort(ctx, r.WorkspaceID, r.ID)
		}
		_ = a.Store.DeleteIngress(ctx, r.ID)
	}
	if len(items) > 0 {
		a.rewriteIngress(ctx)
	}
}

func (a *App) IngressPublicInfo(ctx context.Context) map[string]any {
	zonesOut := []map[string]any{}
	if zones, err := a.Store.ListIngressDomainZones(ctx); err == nil {
		for _, z := range zones {
			if !z.Enabled {
				continue
			}
			zonesOut = append(zonesOut, map[string]any{
				"id":                  z.ID.String(),
				"suffix":              z.Suffix,
				"display_name":        z.DisplayName,
				"require_approval":    z.RequireApproval,
				"allow_random":        z.AllowRandom,
				"allow_custom_prefix": z.AllowCustomPrefix,
			})
		}
	}
	fab := FabricEdgeHost()
	return map[string]any{
		"public_host":        PublicIngressHost(),
		"presets":            ingress.Presets(),
		"zones":              zonesOut,
		"fabric_host":        fab,
		"fabric_http_port":   FabricHTTPPort(),
		"fabric_dns":         fab,
		"preferred_registry": PreferredRegistry(),
		"note": "公网 A 记录仍指入口机；已加入 EasyTier 时把 DNS 指向 fabric_dns（仅 cl.qzsyzn.com 后缀），" +
			"域名不变、流量走虚网、不经 42 公网网卡。默认每个主机只暴露一个服务端口。",
	}
}
