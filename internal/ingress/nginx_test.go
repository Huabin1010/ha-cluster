package ingress

import (
	"strings"
	"testing"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
)

func TestRenderNocacheDefault(t *testing.T) {
	body := Render(RenderInput{
		Route: models.IngressRoute{
			ID:     uuid.MustParse("11111111-1111-1111-1111-111111111111"),
			Domain: "app.example.com",
			Path:   "/",
			Port:   8080,
			Preset: models.IngressNocache,
		},
		Upstream: "10.88.0.30:8080",
	})
	for _, want := range []string{
		"server_name app.example.com;",
		"proxy_pass http://10.88.0.30:8080;",
		"proxy_cache off;",
		"no-cache",
		"proxy_read_timeout 3600s;",
		"send_timeout 3600s;",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("missing %q in\n%s", want, body)
		}
	}
}

func TestValidDomain(t *testing.T) {
	if !ValidDomain("Foo.Example.COM") || ValidDomain("no spaces") || ValidDomain("a") {
		t.Fatal("domain validation")
	}
}

func TestSanitizeExtra(t *testing.T) {
	if _, err := SanitizeExtra("add_header X-Foo bar;"); err != nil {
		t.Fatal(err)
	}
	if _, err := SanitizeExtra("} server {"); err == nil {
		t.Fatal("want reject")
	}
}
