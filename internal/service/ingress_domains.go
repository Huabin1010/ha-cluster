package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/ingress"
	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

func (a *App) EnsureIngressDomainZones(ctx context.Context) {
	items, err := a.Store.ListIngressDomainZones(ctx)
	if err != nil || len(items) > 0 {
		return
	}
	suf := ingress.NormalizeSuffix(os.Getenv("HA_INGRESS_SHARED_SUFFIX"))
	if suf == "" || !ingress.ValidDomain(suf) {
		return
	}
	now := time.Now()
	z := &models.IngressDomainZone{
		ID:                uuid.New(),
		Suffix:            suf,
		DisplayName:       "公共应用域",
		RequireApproval:   false,
		Enabled:           true,
		AllowRandom:       true,
		AllowCustomPrefix: true,
		SortOrder:         0,
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	_ = a.Store.CreateIngressDomainZone(ctx, z)
}

type CreateIngressDomainZoneInput struct {
	Suffix            string
	DisplayName       string
	RequireApproval   bool
	Enabled           bool
	AllowRandom       bool
	AllowCustomPrefix bool
	SortOrder         int
	Actor             models.User
}

func (a *App) ListIngressDomainZonesAdmin(ctx context.Context, actor models.User) ([]models.IngressDomainZone, error) {
	if actor.PlatformRole != models.RolePlatformAdmin {
		return nil, store.ErrForbidden
	}
	return a.Store.ListIngressDomainZones(ctx)
}

func (a *App) CreateIngressDomainZone(ctx context.Context, in CreateIngressDomainZoneInput) (*models.IngressDomainZone, error) {
	if in.Actor.PlatformRole != models.RolePlatformAdmin {
		return nil, store.ErrForbidden
	}
	suf := ingress.NormalizeSuffix(in.Suffix)
	if suf == "" || !ingress.ValidDomain(suf) {
		return nil, store.ErrInvalidInput
	}
	name := strings.TrimSpace(in.DisplayName)
	if name == "" {
		name = suf
	}
	allowRandom := in.AllowRandom
	allowCustom := in.AllowCustomPrefix
	if in.RequireApproval {
		allowRandom = false
		allowCustom = false
	} else if !allowRandom && !allowCustom {
		allowRandom = true
		allowCustom = true
	}
	now := time.Now()
	z := &models.IngressDomainZone{
		ID:                uuid.New(),
		Suffix:            suf,
		DisplayName:       name,
		RequireApproval:   in.RequireApproval,
		Enabled:           in.Enabled,
		AllowRandom:       allowRandom,
		AllowCustomPrefix: allowCustom,
		SortOrder:         in.SortOrder,
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	if err := a.Store.CreateIngressDomainZone(ctx, z); err != nil {
		return nil, err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: in.Actor.ID, Action: "ingress_domain_zone.create",
		ResourceType: "ingress_domain_zone", ResourceID: z.ID.String(),
		Meta: map[string]any{"suffix": z.Suffix, "require_approval": z.RequireApproval},
	})
	return z, nil
}

type PatchIngressDomainZoneInput struct {
	Suffix            *string
	DisplayName       *string
	RequireApproval   *bool
	Enabled           *bool
	AllowRandom       *bool
	AllowCustomPrefix *bool
	SortOrder         *int
	Actor             models.User
}

func (a *App) PatchIngressDomainZone(ctx context.Context, id uuid.UUID, in PatchIngressDomainZoneInput) (*models.IngressDomainZone, error) {
	if in.Actor.PlatformRole != models.RolePlatformAdmin {
		return nil, store.ErrForbidden
	}
	z, err := a.Store.GetIngressDomainZone(ctx, id)
	if err != nil {
		return nil, err
	}
	if in.Suffix != nil {
		suf := ingress.NormalizeSuffix(*in.Suffix)
		if suf == "" || !ingress.ValidDomain(suf) {
			return nil, store.ErrInvalidInput
		}
		z.Suffix = suf
	}
	if in.DisplayName != nil {
		name := strings.TrimSpace(*in.DisplayName)
		if name == "" {
			return nil, store.ErrInvalidInput
		}
		z.DisplayName = name
	}
	if in.RequireApproval != nil {
		z.RequireApproval = *in.RequireApproval
	}
	if in.Enabled != nil {
		z.Enabled = *in.Enabled
	}
	if in.AllowRandom != nil {
		z.AllowRandom = *in.AllowRandom
	}
	if in.AllowCustomPrefix != nil {
		z.AllowCustomPrefix = *in.AllowCustomPrefix
	}
	if in.SortOrder != nil {
		z.SortOrder = *in.SortOrder
	}
	if z.RequireApproval {
		z.AllowRandom = false
		z.AllowCustomPrefix = false
	} else if !z.AllowRandom && !z.AllowCustomPrefix {
		z.AllowRandom = true
		z.AllowCustomPrefix = true
	}
	z.UpdatedAt = time.Now()
	if err := a.Store.UpdateIngressDomainZone(ctx, z); err != nil {
		return nil, err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: in.Actor.ID, Action: "ingress_domain_zone.update",
		ResourceType: "ingress_domain_zone", ResourceID: z.ID.String(),
		Meta: map[string]any{"suffix": z.Suffix},
	})
	return z, nil
}

func (a *App) DeleteIngressDomainZone(ctx context.Context, actor models.User, id uuid.UUID) error {
	if actor.PlatformRole != models.RolePlatformAdmin {
		return store.ErrForbidden
	}
	if err := a.Store.DeleteIngressDomainZone(ctx, id); err != nil {
		return err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: actor.ID, Action: "ingress_domain_zone.delete",
		ResourceType: "ingress_domain_zone", ResourceID: id.String(),
	})
	return nil
}

type ClaimSharedIngressInput struct {
	WorkspaceID       uuid.UUID
	ZoneID            uuid.UUID
	Mode              string // random | custom
	Prefix            string
	Port              int
	Preset            string
	ExtraNginx        string
	ConfirmSecondPort bool
	Actor             models.User
}

func (a *App) ClaimSharedIngress(ctx context.Context, in ClaimSharedIngressInput) (*models.IngressRoute, error) {
	ws, err := a.Store.GetWorkspace(ctx, in.WorkspaceID)
	if err != nil {
		return nil, err
	}
	if _, err := a.RequireMembership(ctx, in.Actor, ws.ProjectID, models.RoleDeveloper); err != nil {
		return nil, err
	}
	if ws.Status != models.WSRunning && ws.Status != models.WSDegraded {
		return nil, store.ErrInvalidInput
	}
	z, err := a.Store.GetIngressDomainZone(ctx, in.ZoneID)
	if err != nil {
		return nil, err
	}
	if !z.Enabled || z.RequireApproval {
		return nil, store.ErrInvalidInput
	}
	mode := strings.ToLower(strings.TrimSpace(in.Mode))
	var prefix string
	switch mode {
	case "random":
		if !z.AllowRandom {
			return nil, store.ErrInvalidInput
		}
		prefix, err = a.allocateRandomPrefix(ctx, z.Suffix)
		if err != nil {
			return nil, err
		}
	case "custom":
		if !z.AllowCustomPrefix {
			return nil, store.ErrInvalidInput
		}
		prefix = strings.ToLower(strings.TrimSpace(in.Prefix))
		if !ingress.ValidPrefix(prefix) || ingress.IsPrefixReserved(prefix) {
			return nil, store.ErrInvalidInput
		}
	default:
		return nil, store.ErrInvalidInput
	}
	domain := prefix + "." + z.Suffix
	if !ingress.ValidDomain(domain) {
		return nil, store.ErrInvalidInput
	}
	return a.createIngressRoute(ctx, createRouteParams{
		WS: ws, Domain: domain, Path: "/", Port: in.Port, Preset: in.Preset,
		ExtraNginx: in.ExtraNginx, ConfirmSecondPort: in.ConfirmSecondPort,
		Actor: in.Actor, Status: models.IngressActive, DomainTier: models.IngressTierShared,
		ZoneID: &z.ID, Prefix: prefix, AutoReview: true,
	})
}

func (a *App) allocateRandomPrefix(ctx context.Context, suffix string) (string, error) {
	for i := 0; i < 16; i++ {
		var b [4]byte
		if _, err := rand.Read(b[:]); err != nil {
			return "", err
		}
		prefix := hex.EncodeToString(b[:]) // 8 hex chars
		if ingress.IsPrefixReserved(prefix) {
			continue
		}
		domain := prefix + "." + suffix
		if _, err := a.Store.GetIngressByDomain(ctx, domain); err == store.ErrNotFound {
			return prefix, nil
		} else if err != nil {
			return "", err
		}
	}
	return "", store.ErrConflict
}

func (a *App) domainMatchesConfiguredZone(ctx context.Context, domain string) (bool, error) {
	domain = strings.ToLower(strings.TrimSpace(domain))
	zones, err := a.Store.ListIngressDomainZones(ctx)
	if err != nil {
		return false, err
	}
	for _, z := range zones {
		suf := strings.ToLower(z.Suffix)
		if domain == suf || strings.HasSuffix(domain, "."+suf) {
			return true, nil
		}
	}
	return false, nil
}

func canBypassIngressApproval(mem models.Membership, actor models.User) bool {
	if actor.PlatformRole == models.RolePlatformAdmin {
		return true
	}
	return mem.Role == models.RoleOwner || mem.Role == models.RoleAdmin
}
