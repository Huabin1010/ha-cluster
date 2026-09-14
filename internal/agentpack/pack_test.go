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
	if p.Version != Version || p.ReleasedAt != ReleasedAt {
		t.Fatalf("version %+v", p)
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
	if strings.TrimSpace(p.Files[VersionPath]) != Version {
		t.Fatalf("VERSION file %q", p.Files[VersionPath])
	}
	if !strings.Contains(p.Files[SkillPath], `pack_version: "`+Version+`"`) {
		t.Fatalf("skill missing pack_version: %s", p.Files[SkillPath][:200])
	}
	if !strings.Contains(p.InstallPrompt, "/agent-pack/version") {
		t.Fatalf("prompt must mention version check: %s", p.InstallPrompt)
	}
	if !strings.Contains(p.Files[WorkflowsPath], "docker.cnb.cool") {
		t.Fatal("workflows should recommend CNB")
	}
	if !strings.Contains(p.Files[WorkflowsPath], "/k8s/apply") || !strings.Contains(p.Files[APIRefPath], "runtime") {
		t.Fatal("pack should document k8s apply")
	}
	if !strings.Contains(p.Files[WorkflowsPath], "审批链与 Docker 相同") {
		t.Fatal("pack should say k8s uses the same approval as docker")
	}
	if !strings.Contains(p.Files[SkillPath], "审批与 Docker 相同") {
		t.Fatal("skill should say k8s uses the same approval as docker")
	}
	if !strings.Contains(p.Files[SkillPath], "默认开 Docker + SSH") && !strings.Contains(p.Files[SkillPath], "runtime=container") {
		t.Fatal("skill should default to compose/container")
	}
	if !strings.Contains(p.Files[APIRefPath], "purpose") || !strings.Contains(p.Files[SkillPath], "purpose") {
		t.Fatal("pack should require project purpose")
	}
	if !strings.Contains(p.Files[SkillPath], "PURPOSE_REQUIRED") {
		t.Fatal("pack should freeze projects missing purpose")
	}
	if !strings.Contains(p.Files[RulePath], "构建只能在本机运行") || !strings.Contains(p.Files[SkillPath], "不允许在我们申请的机器中运行") {
		t.Fatal("pack should forbid builds on workspaces")
	}
	if strings.Contains(p.Files[WorkflowsPath], "base64 -d >") {
		t.Fatal("write-file example must not use base64 -d; stdin_b64 is already decoded")
	}
	if !strings.Contains(p.Files[WorkflowsPath], `cat > /tmp/note.txt`) {
		t.Fatal("write-file example should cat stdin to the file")
	}
	if !strings.Contains(p.Files[SkillPath], "credsStore") || !strings.Contains(p.Files[SkillPath], "IndexConfigs") {
		t.Fatal("skill should detect CNB via config.json / credsStore, not docker info IndexConfigs")
	}
	if !strings.Contains(p.Files[SkillPath], "$pid") || !strings.Contains(p.Files[RulePath], "$pid") {
		t.Fatal("pack should warn Windows agents not to use $pid")
	}
	if !strings.Contains(p.Files[APIRefPath], "include_destroyed") || !strings.Contains(p.Files[SkillPath], "EXEC_UNAVAILABLE") {
		t.Fatal("pack should document hidden destroyed workspaces and EXEC_UNAVAILABLE")
	}
	if !strings.Contains(p.Files[SkillPath], "exec_ready") || !strings.Contains(p.Files[APIRefPath], "exec_ready") {
		t.Fatal("pack should tell agents to prefer exec_ready=true")
	}
	if !strings.Contains(p.Files[APIRefPath], "/k8s/status") || !strings.Contains(p.Files[WorkflowsPath], "/k8s/status") {
		t.Fatal("pack should tell agents to poll k8s status instead of exec")
	}
	if !strings.Contains(p.Files[WorkflowsPath], "project-quota") || !strings.Contains(p.Files[SkillPath], "k8s/status") {
		t.Fatal("pack should warn about quota requests and status API")
	}
	if !strings.Contains(p.Files[WorkflowsPath], "跳板") && !strings.Contains(p.Files[SkillPath], "跳板") {
		t.Fatal("pack should forbid using a docker workspace as k8s jump host")
	}
	if !strings.Contains(p.Files[SkillPath], "禁止") || !strings.Contains(p.Files[WorkflowsPath], "传二进制") {
		t.Fatal("pack should forbid shipping binaries through exec")
	}
	md := Markdown(p)
	if !strings.Contains(md, SkillPath) || !strings.Contains(md, "HA_CLUSTER_AGENT_PACK v"+Version) {
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
