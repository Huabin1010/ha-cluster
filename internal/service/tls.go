package service

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
	"ha-cluster/internal/tlsacme"
)

func (a *App) issuer() tlsacme.Issuer {
	return tlsacme.PickIssuer(a.Store)
}

func (a *App) ListTLSCerts(ctx context.Context, actor models.User) ([]models.TLSCert, error) {
	if actor.PlatformRole != models.RolePlatformAdmin {
		return nil, store.ErrForbidden
	}
	items, err := a.Store.ListTLSCerts(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]models.TLSCert, 0, len(items))
	for _, c := range items {
		out = append(out, c.Public())
	}
	return out, nil
}

func (a *App) EnsureTLSForZones(ctx context.Context) {
	zones, err := a.Store.ListIngressDomainZones(ctx)
	if err != nil {
		return
	}
	for i := range zones {
		if !zones[i].Enabled {
			continue
		}
		if _, err := a.ensureTLSCertForZone(ctx, zones[i]); err != nil {
			log.Printf("tls ensure zone %s: %v", zones[i].Suffix, err)
		}
	}
}

func (a *App) ensureTLSCertForZone(ctx context.Context, z models.IngressDomainZone) (*models.TLSCert, error) {
	if existing, err := a.Store.GetTLSCertByZone(ctx, z.ID); err == nil {
		return existing, nil
	}
	now := time.Now()
	zid := z.ID
	c := &models.TLSCert{
		ID:        uuid.New(),
		Name:      "*." + z.Suffix,
		Names:     tlsacme.WildcardNames(z.Suffix),
		ZoneID:    &zid,
		AutoRenew: true,
		Status:    models.TLSPending,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := a.Store.CreateTLSCert(ctx, c); err != nil {
		if existing, gerr := a.Store.GetTLSCertByZone(ctx, z.ID); gerr == nil {
			return existing, nil
		}
		return nil, err
	}
	return c, nil
}

func (a *App) IssueTLSCert(ctx context.Context, actor models.User, id uuid.UUID) (*models.TLSCert, error) {
	if actor.PlatformRole != models.RolePlatformAdmin {
		return nil, store.ErrForbidden
	}
	c, err := a.issueTLS(ctx, id)
	if err != nil {
		return nil, err
	}
	_ = a.Store.AddAudit(ctx, models.AuditLog{
		ActorUserID: actor.ID, Action: "tls.issue",
		ResourceType: "tls_cert", ResourceID: c.ID.String(),
		Meta: map[string]any{"name": c.Name, "names": c.Names, "status": c.Status, "issuer": c.Issuer},
	})
	pub := c.Public()
	return &pub, nil
}

func (a *App) SetTLSAutoRenew(ctx context.Context, actor models.User, id uuid.UUID, auto bool) (*models.TLSCert, error) {
	if actor.PlatformRole != models.RolePlatformAdmin {
		return nil, store.ErrForbidden
	}
	c, err := a.Store.GetTLSCert(ctx, id)
	if err != nil {
		return nil, err
	}
	c.AutoRenew = auto
	c.UpdatedAt = time.Now()
	if err := a.Store.UpdateTLSCert(ctx, c); err != nil {
		return nil, err
	}
	pub := c.Public()
	return &pub, nil
}

func (a *App) issueTLS(ctx context.Context, id uuid.UUID) (*models.TLSCert, error) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Minute)
	defer cancel()
	c, err := a.Store.GetTLSCert(ctx, id)
	if err != nil {
		return nil, err
	}
	iss := a.issuer()
	if iss == nil {
		c.Status = models.TLSFailed
		c.LastError = "未配置 ACME DNS（HA_DNSPOD_ID/TOKEN，或 HA_BT_PANEL/HA_BT_KEY；开发可用 HA_TLS_SELF_SIGNED=1）"
		c.UpdatedAt = time.Now()
		_ = a.Store.UpdateTLSCert(ctx, c)
		return c, fmt.Errorf("%s", c.LastError)
	}
	c.Status = models.TLSRenewing
	c.LastError = ""
	c.UpdatedAt = time.Now()
	_ = a.Store.UpdateTLSCert(ctx, c)

	bundle, err := iss.Issue(ctx, c.Names)
	if err != nil {
		c.Status = models.TLSFailed
		c.LastError = err.Error()
		c.UpdatedAt = time.Now()
		_ = a.Store.UpdateTLSCert(ctx, c)
		return c, err
	}
	now := time.Now()
	c.CertPEM = string(bundle.CertPEM)
	c.KeyPEM = string(bundle.KeyPEM)
	c.Issuer = bundle.Issuer
	c.NotBefore = &bundle.NotBefore
	c.NotAfter = &bundle.NotAfter
	c.LastIssuedAt = &now
	c.Status = models.TLSIssued
	c.LastError = ""
	c.UpdatedAt = now
	if err := a.Store.UpdateTLSCert(ctx, c); err != nil {
		return nil, err
	}
	if dep := tlsacme.DefaultDeployer(); dep != nil {
		if derr := dep.Deploy(ctx, c.Names, bundle.CertPEM, bundle.KeyPEM); derr != nil {
			c.LastError = "证书已签发，部署失败：" + derr.Error()
			c.UpdatedAt = time.Now()
			_ = a.Store.UpdateTLSCert(ctx, c)
			log.Printf("tls deploy %s: %v", strings.Join(c.Names, ","), derr)
		}
	}
	return c, nil
}

func (a *App) RenewDueTLSCerts(ctx context.Context) (issued, skipped, failed int) {
	a.EnsureTLSForZones(ctx)
	items, err := a.Store.ListTLSCerts(ctx)
	if err != nil {
		log.Printf("tls list: %v", err)
		return
	}
	now := time.Now()
	window := tlsacme.RenewWindow()
	for i := range items {
		c := items[i]
		if !c.NeedsRenew(now, window) {
			skipped++
			continue
		}
		if _, err := a.issueTLS(ctx, c.ID); err != nil {
			failed++
			log.Printf("tls renew %s: %v", c.Name, err)
			continue
		}
		issued++
	}
	return issued, skipped, failed
}
