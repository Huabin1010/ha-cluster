package service

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/edge"
	"ha-cluster/internal/ingress"
	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

// Custom-domain (CNAME) lifecycle:
//
//	create (verify_kind=cname) → pending_dns
//	DNS check ok               → active, nginx rewritten, edge Attach + IssueCert
//	CNAME removed later        → stays active, dns_error set (never auto-deleted)
//	pending_dns > 72h          → expired (deleted) so a squatter cannot hold a domain
//
// Ownership proof: the user's domain must CNAME to a per-route target
// (r-<10hex>.<base>). A shared target alone would let anyone claim a domain
// that some earlier user had pointed at the platform.

const (
	cnamePendingFastWindow = 24 * time.Hour
	cnamePendingSlowEvery  = 10 * time.Minute
	cnameActiveRecheck     = 6 * time.Hour
	cnamePendingExpiry     = 72 * time.Hour
	cnameCheckTimeout      = 8 * time.Second
)

// CNAMEBase is the platform hostname that per-route targets live under.
// Empty means custom domains via CNAME are not configured.
func CNAMEBase() string {
	t := ingress.CNAMETargets(PublicIngressHost())
	if len(t) == 0 {
		return ""
	}
	return t[0]
}

// RouteCNAMETarget is the exact CNAME value the user must set for route id.
func RouteCNAMETarget(id uuid.UUID) string {
	base := CNAMEBase()
	if base == "" {
		return ""
	}
	return ingress.RouteTargetLabel(id) + "." + base
}

func (a *App) resolver() ingress.Resolver {
	if a.Resolver == nil {
		a.Resolver = ingress.PublicResolver()
	}
	return a.Resolver
}

func (a *App) edgeProvider() edge.CustomDomainEdge {
	if a.Edge == nil {
		a.Edge = edge.NoopEdge{}
	}
	return a.Edge
}

// runEdgeJob runs slow edge work (ACME can take minutes) off the request path.
// Unit tests set HA_PROVISION_SYNC=1 to run it inline.
func (a *App) runEdgeJob(fn func(ctx context.Context)) {
	if provisionSync() {
		fn(context.Background())
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		fn(ctx)
	}()
}

// validateCustomCNAMEDomain rejects domains that can never pass CNAME checks.
func validateCustomCNAMEDomain(domain string) error {
	if CNAMEBase() == "" {
		return store.Wrap(store.ErrInvalidInput, "平台尚未配置 CNAME 入口（HA_INGRESS_CNAME_TARGETS），暂不能绑定自有域名")
	}
	if ingress.IsApexDomain(domain) {
		return store.Wrap(store.ErrInvalidInput, domain+" 是根域，根域不能设置 CNAME，请使用子域（如 www."+domain+"）")
	}
	base := CNAMEBase()
	if domain == base || strings.HasSuffix(domain, "."+base) {
		return store.Wrap(store.ErrInvalidInput, "不能绑定平台入口自身的域名")
	}
	return nil
}

// VerifyIngressDNS runs a CNAME check now (the console「立即检测」button).
func (a *App) VerifyIngressDNS(ctx context.Context, actor models.User, id uuid.UUID) (*models.IngressRoute, error) {
	r, err := a.Store.GetIngress(ctx, id)
	if err != nil {
		return nil, err
	}
	if _, err := a.RequireProjectReady(ctx, actor, r.ProjectID, models.RoleDeveloper); err != nil {
		return nil, err
	}
	if r.VerifyKind != models.IngressVerifyCNAME {
		return nil, store.Wrap(store.ErrInvalidInput, "该路由不是自有域名（CNAME）路由，无需检测")
	}
	r = a.checkCustomDomain(ctx, r, actor.ID)
	if r.Status == models.IngressActive && r.TLSStatus == models.IngressTLSFailed {
		a.startEdgeTLS(r.ID)
		if fresh, err := a.Store.GetIngress(ctx, r.ID); err == nil {
			r = fresh
		}
	}
	a.annotateRoute(ctx, r)
	return r, nil
}

// checkCustomDomain resolves the domain once, records the result, and
// activates the route on first success. Returns the latest stored route.
func (a *App) checkCustomDomain(ctx context.Context, r *models.IngressRoute, actorID uuid.UUID) *models.IngressRoute {
	cctx, cancel := context.WithTimeout(ctx, cnameCheckTimeout)
	res := ingress.VerifyCNAMEStrict(cctx, a.resolver(), r.Domain, []string{RouteCNAMETarget(r.ID)})
	cancel()

	now := time.Now()
	r.DNSCheckedAt = &now
	if res.OK {
		r.DNSCode = ingress.CNAMEOK
		r.DNSError = ""
	} else {
		r.DNSCode = res.Code
		r.DNSError = res.Message
	}

	activate := res.OK && r.Status == models.IngressPendingDNS
	if activate {
		if ws, err := a.Store.GetWorkspace(ctx, r.WorkspaceID); err == nil {
			if hp, err := a.exposeWorkspacePort(ctx, ws, r.ID, r.Port); err == nil && hp > 0 {
				r.HostPort = hp
			}
		}
		r.Status = models.IngressActive
		r.ReviewedAt = &now
		r.TLSStatus = models.IngressTLSPending
		r.TLSError = ""
	}
	if err := a.Store.UpdateIngress(ctx, r); err != nil {
		log.Printf("ingress cname update %s: %v", r.Domain, err)
		return r
	}
	if activate {
		a.rewriteIngress(ctx)
		_ = a.Store.AddAudit(ctx, models.AuditLog{
			ActorUserID: actorID, Action: "ingress.dns_verified",
			ResourceType: "ingress", ResourceID: r.ID.String(),
			Meta: map[string]any{"domain": r.Domain, "target": RouteCNAMETarget(r.ID)},
		})
		a.startEdgeTLS(r.ID)
		if fresh, err := a.Store.GetIngress(ctx, r.ID); err == nil {
			r = fresh
		}
	}
	return r
}

// startEdgeTLS attaches the domain to the public edge and requests HTTPS.
// Only TLS fields are written, on a freshly loaded row, so concurrent edits
// to the route are not clobbered.
func (a *App) startEdgeTLS(id uuid.UUID) {
	a.runEdgeJob(func(ctx context.Context) {
		r, err := a.Store.GetIngress(ctx, id)
		if err != nil || r.Status != models.IngressActive {
			return
		}
		e := a.edgeProvider()
		status, msg := models.IngressTLSIssued, ""
		if err := e.Attach(ctx, r.Domain); err != nil {
			status, msg = models.IngressTLSFailed, "入口接入失败："+err.Error()
		} else if _, err := e.IssueCert(ctx, r.Domain); err != nil {
			if errors.Is(err, edge.ErrNoTLS) {
				status, msg = models.IngressTLSSkipped, err.Error()
			} else {
				status, msg = models.IngressTLSFailed, err.Error()
			}
		}
		fresh, err := a.Store.GetIngress(ctx, id)
		if err != nil {
			return
		}
		fresh.TLSStatus = status
		fresh.TLSError = msg
		if err := a.Store.UpdateIngress(ctx, fresh); err != nil {
			log.Printf("ingress tls update %s: %v", fresh.Domain, err)
		}
		_ = a.Store.AddAudit(ctx, models.AuditLog{
			Action: "ingress.edge_tls", ResourceType: "ingress", ResourceID: id.String(),
			Meta: map[string]any{"domain": fresh.Domain, "provider": e.Name(), "tls_status": status, "error": msg},
		})
	})
}

// detachEdge removes a custom domain from the public edge (best effort).
func (a *App) detachEdge(r models.IngressRoute) {
	if r.VerifyKind != models.IngressVerifyCNAME || r.TLSStatus == models.IngressTLSNone {
		return
	}
	domain := r.Domain
	a.runEdgeJob(func(ctx context.Context) {
		if err := a.edgeProvider().Detach(ctx, domain); err != nil {
			log.Printf("edge detach %s: %v", domain, err)
		}
	})
}

// VerifyPendingCustomDomains is one pass of the background verifier.
// Pending routes are checked every pass during the first 24h, then every
// 10 minutes; they expire after 72h. Active routes are re-checked every 6h,
// and a failed certificate is retried on that re-check.
func (a *App) VerifyPendingCustomDomains(ctx context.Context, now time.Time) (verified, expired int) {
	routes, err := a.Store.ListIngress(ctx, nil)
	if err != nil {
		return 0, 0
	}
	for i := range routes {
		r := routes[i]
		if r.VerifyKind != models.IngressVerifyCNAME {
			continue
		}
		age := now.Sub(r.CreatedAt)
		sinceCheck := time.Duration(1<<62 - 1)
		if r.DNSCheckedAt != nil {
			sinceCheck = now.Sub(*r.DNSCheckedAt)
		}
		switch r.Status {
		case models.IngressPendingDNS:
			if age > cnamePendingExpiry {
				if err := a.Store.DeleteIngress(ctx, r.ID); err == nil {
					expired++
					_ = a.Store.AddAudit(ctx, models.AuditLog{
						Action: "ingress.dns_expired", ResourceType: "ingress", ResourceID: r.ID.String(),
						Meta: map[string]any{"domain": r.Domain, "project": r.ProjectID.String()},
					})
				}
				continue
			}
			if age > cnamePendingFastWindow && sinceCheck < cnamePendingSlowEvery {
				continue
			}
			got := a.checkCustomDomain(ctx, &r, uuid.Nil)
			if got.Status == models.IngressActive {
				verified++
			}
		case models.IngressActive:
			if sinceCheck < cnameActiveRecheck {
				continue
			}
			got := a.checkCustomDomain(ctx, &r, uuid.Nil)
			if got.TLSStatus == models.IngressTLSFailed && got.DNSCode == ingress.CNAMEOK {
				a.startEdgeTLS(got.ID)
			}
		}
	}
	return verified, expired
}

func (a *App) annotateCNAME(r *models.IngressRoute) {
	target := RouteCNAMETarget(r.ID)
	r.CNAMETarget = target
	r.RecordHost, r.RecordZone = ingress.SplitRecordHost(r.Domain)
	if target == "" {
		r.DNSHint = "平台尚未配置 CNAME 入口，请联系平台管理员。"
		return
	}
	r.DNSHint = "在 " + r.RecordZone + " 的 DNS 里添加一条记录：主机记录 " + r.RecordHost +
		"，类型 CNAME，记录值 " + target + "。生效后平台会自动检测并开启 HTTPS。"
}
