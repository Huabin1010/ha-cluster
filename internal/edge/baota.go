package edge

import (
	"context"
	"crypto/md5"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// BaotaEdge attaches each custom domain as its own Baota site (Baota holds
// one certificate per site), reverse-proxied to the compose edge Nginx.
// The call sequence mirrors deploy/prod/baota_api.py ensure-site /
// ensure-proxy / ensure-ssl, which is verified on 42.
type BaotaEdge struct {
	Panel   string
	Key     string
	Target  string // e.g. http://127.0.0.1:18080 (compose edge Nginx)
	RootDir string // site root parent, e.g. /www/wwwroot
	Email   string
	HTTP    *http.Client
	Now     func() time.Time
}

func BaotaFromEnv() *BaotaEdge {
	panel := strings.TrimRight(strings.TrimSpace(os.Getenv("HA_BT_PANEL")), "/")
	key := strings.TrimSpace(os.Getenv("HA_BT_KEY"))
	if panel == "" || key == "" {
		return nil
	}
	target := strings.TrimSpace(os.Getenv("HA_BT_EDGE_TARGET"))
	if target == "" {
		target = "http://127.0.0.1:18080"
	}
	root := strings.TrimRight(strings.TrimSpace(os.Getenv("HA_BT_SITE_ROOT")), "/")
	if root == "" {
		root = "/www/wwwroot"
	}
	return &BaotaEdge{
		Panel: panel, Key: key, Target: target, RootDir: root,
		Email: strings.TrimSpace(os.Getenv("HA_BT_SSL_EMAIL")),
		HTTP:  &http.Client{Timeout: 120 * time.Second},
	}
}

func (b *BaotaEdge) Name() string { return "baota" }

const proxyName = "ha-edge"

type btSite struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Path string `json:"path"`
}

func (b *BaotaEdge) Attach(ctx context.Context, domain string) error {
	domain = normDomain(domain)
	site, err := b.findSite(ctx, domain)
	if err != nil {
		return err
	}
	if site == nil {
		webname, _ := json.Marshal(map[string]any{"domain": domain, "domainlist": []string{}, "count": 0})
		if _, err := b.post(ctx, "/site?action=AddSite", url.Values{
			"webname": {string(webname)},
			"path":    {b.RootDir + "/" + domain},
			"type_id": {"-1"},
			"type":    {"PHP"},
			"version": {"00"},
			"port":    {"80"},
			"ps":      {"ha-cluster custom domain"},
			"ftp":     {"false"},
			"sql":     {"false"},
		}); err != nil {
			return fmt.Errorf("宝塔建站 %s: %w", domain, err)
		}
	}
	return b.ensureProxy(ctx, domain)
}

func (b *BaotaEdge) ensureProxy(ctx context.Context, domain string) error {
	form := url.Values{
		"proxyname": {proxyName},
		"sitename":  {domain},
		"proxydir":  {"/"},
		"proxysite": {b.Target},
		"todomain":  {"$host"},
		"type":      {"1"},
		"cache":     {"0"},
		"subfilter": {`[{"sub1":"","sub2":""}]`},
		"advanced":  {"0"},
		"cachetime": {"1"},
	}
	raw, err := b.post(ctx, "/site?action=GetProxyList", url.Values{"sitename": {domain}})
	if err != nil {
		return fmt.Errorf("宝塔查询反代 %s: %w", domain, err)
	}
	action := "/site?action=CreateProxy"
	if proxyListHas(raw, proxyName) {
		action = "/site?action=ModifyProxy"
	}
	if _, err := b.post(ctx, action, form); err != nil {
		return fmt.Errorf("宝塔反代 %s: %w", domain, err)
	}
	return nil
}

func proxyListHas(raw []byte, name string) bool {
	var list []map[string]any
	if json.Unmarshal(raw, &list) != nil {
		var wrap struct {
			Data []map[string]any `json:"data"`
		}
		if json.Unmarshal(raw, &wrap) != nil {
			return false
		}
		list = wrap.Data
	}
	for _, p := range list {
		if p["proxyname"] == name {
			return true
		}
	}
	return false
}

func (b *BaotaEdge) IssueCert(ctx context.Context, domain string) (CertInfo, error) {
	domain = normDomain(domain)
	site, err := b.findSite(ctx, domain)
	if err != nil {
		return CertInfo{}, err
	}
	if site == nil {
		return CertInfo{}, fmt.Errorf("宝塔站点 %s 不存在，需先 Attach", domain)
	}
	path := site.Path
	if path == "" {
		path = b.RootDir + "/" + domain
	}
	doms, _ := json.Marshal([]string{domain})
	raw, err := b.post(ctx, "/acme?action=apply_cert_api", url.Values{
		"domains":       {string(doms)},
		"auth_type":     {"http"},
		"auth_to":       {path},
		"auto_wildcard": {"0"},
		"id":            {strconv.FormatInt(site.ID, 10)},
	})
	if err != nil {
		return CertInfo{}, fmt.Errorf("证书申请失败（DNS 是否已指向平台？）: %w", err)
	}
	var out struct {
		PrivateKey string `json:"private_key"`
		Cert       string `json:"cert"`
		Root       string `json:"root"`
	}
	_ = json.Unmarshal(raw, &out)
	if out.PrivateKey == "" || out.Cert == "" {
		return CertInfo{}, fmt.Errorf("证书申请未返回证书内容: %s", truncate(string(raw), 200))
	}
	chain := out.Cert + out.Root
	if _, err := b.post(ctx, "/site?action=SetSSL", url.Values{
		"type":     {"1"},
		"siteName": {domain},
		"key":      {out.PrivateKey},
		"csr":      {chain},
	}); err != nil {
		return CertInfo{}, fmt.Errorf("宝塔挂载证书 %s: %w", domain, err)
	}
	_, _ = b.post(ctx, "/site?action=HttpToHttps", url.Values{"siteName": {domain}})
	return certInfoFromPEM(chain), nil
}

func (b *BaotaEdge) Detach(ctx context.Context, domain string) error {
	domain = normDomain(domain)
	site, err := b.findSite(ctx, domain)
	if err != nil {
		return err
	}
	if site == nil {
		return nil
	}
	if _, err := b.post(ctx, "/site?action=DeleteSite", url.Values{
		"id":      {strconv.FormatInt(site.ID, 10)},
		"webname": {domain},
		"path":    {"1"},
	}); err != nil {
		return fmt.Errorf("宝塔删除站点 %s: %w", domain, err)
	}
	return nil
}

func (b *BaotaEdge) findSite(ctx context.Context, domain string) (*btSite, error) {
	raw, err := b.post(ctx, "/data?action=getData", url.Values{
		"table": {"sites"}, "limit": {"1000"}, "p": {"1"}, "search": {domain},
	})
	if err != nil {
		return nil, fmt.Errorf("宝塔站点列表: %w", err)
	}
	var wrap struct {
		Data []btSite `json:"data"`
	}
	if err := json.Unmarshal(raw, &wrap); err != nil {
		return nil, fmt.Errorf("宝塔站点列表解析: %w", err)
	}
	for i := range wrap.Data {
		if normDomain(wrap.Data[i].Name) == domain {
			return &wrap.Data[i], nil
		}
	}
	return nil, nil
}

func (b *BaotaEdge) now() time.Time {
	if b.Now != nil {
		return b.Now()
	}
	return time.Now()
}

// post signs the request: request_token = md5(request_time + md5(key)).
func (b *BaotaEdge) post(ctx context.Context, path string, form url.Values) ([]byte, error) {
	ts := strconv.FormatInt(b.now().Unix(), 10)
	form.Set("request_time", ts)
	form.Set("request_token", Sign(ts, b.Key))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, b.Panel+path, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	client := b.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode >= 400 {
		return body, fmt.Errorf("HTTP %d: %s", resp.StatusCode, truncate(string(body), 200))
	}
	var st struct {
		Status *bool  `json:"status"`
		Msg    string `json:"msg"`
	}
	if json.Unmarshal(body, &st) == nil && st.Status != nil && !*st.Status {
		msg := st.Msg
		if msg == "" {
			msg = truncate(string(body), 200)
		}
		return body, fmt.Errorf("%s", msg)
	}
	return body, nil
}

// Sign returns the Baota API request_token for a unix-seconds timestamp.
func Sign(ts, key string) string {
	inner := md5.Sum([]byte(key))
	outer := md5.Sum([]byte(ts + hex.EncodeToString(inner[:])))
	return hex.EncodeToString(outer[:])
}

func certInfoFromPEM(chain string) CertInfo {
	info := CertInfo{Issuer: "letsencrypt"}
	block, _ := pem.Decode([]byte(chain))
	if block == nil {
		return info
	}
	leaf, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return info
	}
	na := leaf.NotAfter
	info.NotAfter = &na
	if len(leaf.Issuer.Organization) > 0 {
		info.Issuer = leaf.Issuer.Organization[0]
	} else if leaf.Issuer.CommonName != "" {
		info.Issuer = leaf.Issuer.CommonName
	}
	return info
}

func normDomain(d string) string {
	return strings.TrimSuffix(strings.ToLower(strings.TrimSpace(d)), ".")
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
