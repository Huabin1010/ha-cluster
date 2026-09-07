package ingress

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"ha-cluster/internal/models"
)

var hostRE = regexp.MustCompile(`^(?i:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$`)

func ValidDomain(d string) bool {
	d = strings.ToLower(strings.TrimSpace(d))
	if d == "" || len(d) > 253 || strings.Contains(d, "..") {
		return false
	}
	return hostRE.MatchString(d)
}

func NormalizePath(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return "/"
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return p
}

func ValidPreset(p string) bool {
	switch p {
	case models.IngressNocache, models.IngressTransparent, models.IngressCache, "":
		return true
	default:
		return false
	}
}

func SanitizeExtra(extra string) (string, error) {
	extra = strings.TrimSpace(extra)
	if extra == "" {
		return "", nil
	}
	low := strings.ToLower(extra)
	if strings.Contains(extra, "}") || strings.Contains(low, "server") || strings.Contains(low, "include") {
		return "", fmt.Errorf("extra nginx rejected")
	}
	return extra, nil
}

type RenderInput struct {
	Route    models.IngressRoute
	Upstream string
}

func locationDirectives(preset, extra string) string {
	if preset == "" {
		preset = models.IngressNocache
	}
	common := []string{
		"proxy_http_version 1.1;",
		"proxy_set_header Host $host;",
		"proxy_set_header X-Real-IP $remote_addr;",
		"proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
		"proxy_set_header X-Forwarded-Proto $scheme;",
		"proxy_set_header Upgrade $http_upgrade;",
		"proxy_set_header Connection $connection_upgrade;",
	}
	switch preset {
	case models.IngressTransparent:
		common = append(common,
			"proxy_set_header X-Forwarded-Host $host;",
			"proxy_pass_request_headers on;",
			"proxy_buffering off;",
			"proxy_connect_timeout 3600s;",
			"proxy_send_timeout 3600s;",
			"proxy_read_timeout 3600s;",
			"send_timeout 3600s;",
		)
	case models.IngressCache:
		common = append(common,
			"proxy_buffering on;",
			"proxy_cache_valid 200 1m;",
			"proxy_connect_timeout 60s;",
			"proxy_send_timeout 60s;",
			"proxy_read_timeout 60s;",
		)
	default: // nocache
		common = append(common,
			"proxy_cache off;",
			"proxy_buffering off;",
			`add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" always;`,
			"expires -1;",
			"proxy_connect_timeout 3600s;",
			"proxy_send_timeout 3600s;",
			"proxy_read_timeout 3600s;",
			"send_timeout 3600s;",
		)
	}
	if extra != "" {
		common = append(common, extra)
	}
	var b strings.Builder
	for _, line := range common {
		b.WriteString("        ")
		b.WriteString(line)
		b.WriteByte('\n')
	}
	return b.String()
}

func Render(in RenderInput) string {
	r := in.Route
	domain := strings.ToLower(strings.TrimSpace(r.Domain))
	path := NormalizePath(r.Path)
	up := strings.TrimSpace(in.Upstream)
	if up == "" {
		up = "127.0.0.1:65535"
	}
	loc := path
	if loc != "/" && !strings.HasSuffix(loc, "/") {
		loc += "/"
	}
	return fmt.Sprintf(`# ha-cluster ingress %s → %s%s
server {
    listen 80;
    listen [::]:80;
    server_name %s;
    client_max_body_size 100m;
    location %s {
        proxy_pass http://%s;
%s    }
}
`, r.ID.String(), domain, path, domain, loc, up, locationDirectives(r.Preset, r.ExtraNginx))
}

func WriteAll(dir string, files map[string]string) error {
	if dir == "" {
		return nil
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".conf") {
			_ = os.Remove(filepath.Join(dir, e.Name()))
		}
	}
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0644); err != nil {
			return err
		}
	}
	return nil
}

func Reload(cmd string) error {
	cmd = strings.TrimSpace(cmd)
	if cmd == "" {
		return nil
	}
	return exec.Command("sh", "-c", cmd).Run()
}

func Presets() []map[string]string {
	return []map[string]string{
		{
			"id":          models.IngressNocache,
			"label":       "无缓存（默认）",
			"description": "关闭缓存与缓冲，超时 3600s，适合 SSE / WebSocket / 动态站点",
		},
		{
			"id":          models.IngressTransparent,
			"label":       "透明代理",
			"description": "透传请求头与 Host，超时 3600s，适合需要看到真实客户端信息的后端",
		},
		{
			"id":          models.IngressCache,
			"label":       "短缓存",
			"description": "200 响应缓存 1 分钟，超时 60s，适合静态资源",
		},
	}
}
