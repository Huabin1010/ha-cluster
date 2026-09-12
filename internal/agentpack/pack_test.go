package agentpack

import (
	"strings"
	"testing"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
)

func TestBuildPackContainsAuthAndFiles(t *testing.T) {
	u := models.User{ID: uuid.MustParse("11111111-1111-1111-1111-111111111111"), Username: "chenweipeng", PlatformRole: models.RolePlatformUser}
	p := Build(u, "haagt_deadbeef", "https://cl.qzsyzn.com/api")
	if p.Auth.Username != "chenweipeng" || p.Auth.Token != "haagt_deadbeef" {
		t.Fatalf("auth %+v", p.Auth)
	}
	if !strings.Contains(p.InstallPrompt, "/agent-pack/haagt_deadbeef") {
		t.Fatalf("prompt missing url: %s", p.InstallPrompt)
	}
	if !strings.Contains(p.InstallPrompt, "curl -fsSL") || !strings.Contains(p.InstallPrompt, "Do NOT use Cursor fetch") {
		t.Fatalf("prompt must require curl and ban Cursor fetch: %s", p.InstallPrompt)
	}
	for _, path := range []string{RulePath, SkillPath, WorkflowsPath, APIRefPath} {
		body, ok := p.Files[path]
		if !ok || !strings.Contains(body, "haagt_deadbeef") {
			t.Fatalf("file %s missing token", path)
		}
		if path != APIRefPath && !strings.Contains(body, "chenweipeng") {
			t.Fatalf("file %s missing username", path)
		}
	}
	md := Markdown(p)
	if !strings.Contains(md, SkillPath) || !strings.Contains(md, "HA_CLUSTER_AGENT_PACK") {
		t.Fatal(md[:200])
	}
}

func TestResolveAPIBasePublicHostUsesHTTPS(t *testing.T) {
	t.Setenv("HA_PUBLIC_API", "")
	t.Setenv("HA_API_PUBLIC", "")
	got := ResolveAPIBase("cl.qzsyzn.com", "http", false)
	if got != "https://cl.qzsyzn.com/api" {
		t.Fatalf("got %s", got)
	}
	got = ResolveAPIBase("127.0.0.1:18082", "", false)
	if got != "http://127.0.0.1:18082/api" {
		t.Fatalf("local got %s", got)
	}
}
