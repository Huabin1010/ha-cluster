package agentpack

import (
	"os"
	"strings"
	"time"

	_ "embed"

	"ha-cluster/internal/models"
)

//go:embed embed/rule.mdc.tmpl
var ruleTmpl string

//go:embed embed/SKILL.md.tmpl
var skillTmpl string

//go:embed embed/workflows.md.tmpl
var workflowsTmpl string

//go:embed embed/api-reference.md.tmpl
var apiRefTmpl string

const (
	RulePath      = ".cursor/rules/ha-cluster-agent.mdc"
	SkillPath     = ".cursor/skills/ha-cluster-agent/SKILL.md"
	WorkflowsPath = ".cursor/skills/ha-cluster-agent/workflows.md"
	APIRefPath    = ".cursor/skills/ha-cluster-agent/api-reference.md"
	VersionPath   = ".cursor/skills/ha-cluster-agent/VERSION"

	// Version is a monotonic integer. Bump when pack files change so Agents can self-update.
	Version    = "13"
	ReleasedAt = "2026-09-14"
	Notes      = "工作区带 exec_ready；列表优先挑 SSH 通的机器"
)

type Vars struct {
	APIBase      string
	ConsoleURL   string
	Token        string
	Username     string
	UserID       string
	PlatformRole string
	PackURL      string
	TokenPrefix  string
	CreatedAt    time.Time
}

type File struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type Auth struct {
	APIBase      string `json:"api_base"`
	Token        string `json:"token"`
	Username     string `json:"username"`
	UserID       string `json:"user_id"`
	PlatformRole string `json:"platform_role"`
}

type VersionInfo struct {
	Version    string `json:"version"`
	ReleasedAt string `json:"released_at"`
	Notes      string `json:"notes"`
}

func CurrentVersion() VersionInfo {
	return VersionInfo{Version: Version, ReleasedAt: ReleasedAt, Notes: Notes}
}

type Pack struct {
	Version       string            `json:"version"`
	ReleasedAt    string            `json:"released_at"`
	Notes         string            `json:"notes"`
	InstallPrompt string            `json:"install_prompt"`
	Auth          Auth              `json:"auth"`
	Files         map[string]string `json:"files"`
}

func PublicAPIBase() string {
	for _, k := range []string{"HA_PUBLIC_API", "HA_API_PUBLIC"} {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" {
			return strings.TrimRight(v, "/")
		}
	}
	return "https://cl.qzsyzn.com/api"
}

// ResolveAPIBase prefers env, then the incoming request (so lab / 反代 Host 也对).
func ResolveAPIBase(host, forwardedProto string, tls bool) string {
	for _, k := range []string{"HA_PUBLIC_API", "HA_API_PUBLIC"} {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" {
			return strings.TrimRight(v, "/")
		}
	}
	if host == "" {
		return PublicAPIBase()
	}
	proto := strings.ToLower(strings.TrimSpace(forwardedProto))
	if proto == "" {
		if tls || looksPublicHost(host) {
			proto = "https"
		} else {
			proto = "http"
		}
	} else if proto == "http" && looksPublicHost(host) {
		// TLS 终结在宝塔/反代上时，到容器的 hop 常带 X-Forwarded-Proto: http。
		proto = "https"
	}
	return proto + "://" + host + "/api"
}

func looksPublicHost(host string) bool {
	h := host
	if i := strings.IndexByte(h, ':'); i >= 0 {
		h = h[:i]
	}
	if h == "localhost" || h == "127.0.0.1" || strings.HasPrefix(h, "192.168.") || strings.HasPrefix(h, "10.") {
		return false
	}
	return strings.Contains(h, ".")
}

func ConsoleURL() string {
	if v := strings.TrimSpace(os.Getenv("HA_PUBLIC_CONSOLE")); v != "" {
		return strings.TrimRight(v, "/")
	}
	base := PublicAPIBase()
	return strings.TrimSuffix(base, "/api")
}

func PackURL(apiBase, rawToken string) string {
	return strings.TrimRight(apiBase, "/") + "/agent-pack/" + rawToken
}

func InstallPrompt(v Vars) string {
	return strings.TrimSpace(`Install the ha-cluster Cursor Agent pack now. Do not ask for a password.

HARD RULE: use only curl (Shell / terminal). Do NOT use Cursor fetch, WebFetch,
mcp_web_fetch, browser tools, or any built-in HTTP fetch. curl.exe on Windows is OK.

1. Pull the pack:
   curl -fsSL '` + v.PackURL + `'
   No cookies. No Authorization header. Follow redirects (-L is already in -fsSL).
2. The JSON has:
   - files: { "<relative-path>": "<file content>", ... }
   - auth: { api_base, token, username, user_id, platform_role }
3. Write every files entry into the current workspace (create directories).
   Required paths:
   - ` + RulePath + `
   - ` + SkillPath + `
   - ` + WorkflowsPath + `
   - ` + APIRefPath + `
   - ` + VersionPath + `
4. Then act as user ` + v.Username + `. Read ` + SkillPath + `.
   All later API calls must also be curl, e.g.
   curl -fsS -H "Authorization: Bearer <auth.token>" '` + v.APIBase + `/me'
5. Version check (do this at the start of a session, or when the user says
   the platform / skill was updated):
   curl -fsS '` + v.APIBase + `/agent-pack/version'
   Compare JSON "version" with local ` + VersionPath + ` (or SKILL.md pack_version).
   Version is a rising integer. If remote is greater, curl the pack URL again
   and overwrite the files (keep using the same token).

Do not commit the token or these files to a public remote.
` + "中文：这是我的 ha-cluster 专属 Agent 接入。只用 curl 拉取和调用，禁止 Cursor 自带的 fetch / WebFetch。请立刻 curl 上面的链接，按 files 写入当前项目，然后用我的身份继续 curl API。不要问我密码。")
}

func apply(tmpl string, v Vars) string {
	r := strings.NewReplacer(
		"{{API_BASE}}", v.APIBase,
		"{{CONSOLE_URL}}", v.ConsoleURL,
		"{{TOKEN}}", v.Token,
		"{{USERNAME}}", v.Username,
		"{{USER_ID}}", v.UserID,
		"{{PLATFORM_ROLE}}", v.PlatformRole,
		"{{PACK_URL}}", v.PackURL,
		"{{PACK_VERSION}}", Version,
		"{{PACK_RELEASED_AT}}", ReleasedAt,
		"{{PACK_NOTES}}", Notes,
	)
	return r.Replace(tmpl)
}

func Build(user models.User, rawToken string, apiBase string) Pack {
	if apiBase == "" {
		apiBase = PublicAPIBase()
	}
	v := Vars{
		APIBase:      apiBase,
		ConsoleURL:   ConsoleURL(),
		Token:        rawToken,
		Username:     user.Username,
		UserID:       user.ID.String(),
		PlatformRole: user.PlatformRole,
		PackURL:      PackURL(apiBase, rawToken),
		TokenPrefix:  prefixOf(rawToken),
	}
	files := map[string]string{
		RulePath:      apply(ruleTmpl, v),
		SkillPath:     apply(skillTmpl, v),
		WorkflowsPath: apply(workflowsTmpl, v),
		APIRefPath:    apply(apiRefTmpl, v),
		VersionPath:   Version + "\n",
	}
	return Pack{
		Version:       Version,
		ReleasedAt:    ReleasedAt,
		Notes:         Notes,
		InstallPrompt: InstallPrompt(v),
		Auth: Auth{
			APIBase:      v.APIBase,
			Token:        rawToken,
			Username:     user.Username,
			UserID:       user.ID.String(),
			PlatformRole: user.PlatformRole,
		},
		Files: files,
	}
}

func Markdown(p Pack) string {
	var b strings.Builder
	b.WriteString("<!-- HA_CLUSTER_AGENT_PACK v")
	b.WriteString(Version)
	b.WriteString(" -->\n\n")
	b.WriteString("# Install\n\n")
	b.WriteString(p.InstallPrompt)
	b.WriteString("\n\n")
	for _, path := range []string{RulePath, SkillPath, WorkflowsPath, APIRefPath, VersionPath} {
		b.WriteString("## File: ")
		b.WriteString(path)
		b.WriteString("\n\n```\n")
		b.WriteString(p.Files[path])
		b.WriteString("\n```\n\n")
	}
	return b.String()
}

func prefixOf(token string) string {
	if len(token) > 12 {
		return token[:12]
	}
	return token
}
