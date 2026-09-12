package service

import (
	"testing"
	"time"

	"ha-cluster/internal/models"
	"ha-cluster/internal/store/memory"
	"ha-cluster/internal/workspace"
)

func TestTLSIssueSelfSignedAndRenewWindow(t *testing.T) {
	t.Setenv("HA_TLS_SELF_SIGNED", "1")
	t.Setenv("HA_TLS_DIR", t.TempDir())
	st := memory.New()
	app := New(st, workspace.NewMemoryRuntime(), []byte("unit-test-secret-key-32b!!"))
	admin := models.User{ID: mustUser(t, app, "tlsadmin", "tlsadmin@x.com").ID, Username: "tlsadmin", PlatformRole: models.RolePlatformAdmin}

	z, err := app.CreateIngressDomainZone(t.Context(), CreateIngressDomainZoneInput{
		Suffix: "apps.example.com", DisplayName: "apps", Enabled: true,
		AllowRandom: true, AllowCustomPrefix: true, Actor: admin,
	})
	if err != nil {
		t.Fatal(err)
	}
	cert, err := app.Store.GetTLSCertByZone(t.Context(), z.ID)
	if err != nil {
		t.Fatal(err)
	}
	if cert.Status != models.TLSPending {
		t.Fatalf("status %s", cert.Status)
	}

	out, err := app.IssueTLSCert(t.Context(), admin, cert.ID)
	if err != nil {
		t.Fatal(err)
	}
	if out.Status != models.TLSIssued || out.NotAfter == nil || out.CertPEM != "" {
		t.Fatalf("%+v", out)
	}
	stored, _ := app.Store.GetTLSCert(t.Context(), cert.ID)
	if stored.CertPEM == "" || stored.KeyPEM == "" {
		t.Fatal("pem not stored")
	}
	if stored.NeedsRenew(time.Now(), 30*24*time.Hour) {
		t.Fatal("fresh cert should not need renew")
	}
	if !stored.NeedsRenew(stored.NotAfter.Add(-time.Hour), 30*24*time.Hour) {
		t.Fatal("near expiry should renew")
	}

	list, err := app.ListTLSCerts(t.Context(), admin)
	if err != nil || len(list) != 1 || list[0].KeyPEM != "" {
		t.Fatalf("%v %+v", err, list)
	}
}

func mustUser(t *testing.T, app *App, name, email string) *models.User {
	t.Helper()
	u, err := app.Register(t.Context(), name, email, "password1")
	if err != nil {
		t.Fatal(err)
	}
	u.PlatformRole = models.RolePlatformAdmin
	if err := app.Store.UpdateUser(t.Context(), u); err != nil {
		t.Fatal(err)
	}
	return u
}
