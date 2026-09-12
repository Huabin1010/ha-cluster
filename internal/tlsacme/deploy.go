package tlsacme

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type FileDeployer struct {
	Dir string
}

func (d FileDeployer) Deploy(_ context.Context, names []string, certPEM, keyPEM []byte) error {
	dir := d.Dir
	if dir == "" {
		dir = TLSDir()
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	label := "default"
	if len(names) > 0 {
		label = strings.ReplaceAll(strings.TrimPrefix(names[0], "*."), "*", "wildcard")
	}
	sub := filepath.Join(dir, label)
	if err := os.MkdirAll(sub, 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(sub, "fullchain.pem"), certPEM, 0o600); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(sub, "privkey.pem"), keyPEM, 0o600); err != nil {
		return err
	}
	_ = os.WriteFile(filepath.Join(sub, "names.txt"), []byte(strings.Join(names, "\n")+"\n"), 0o644)
	return nil
}

type MultiDeployer struct {
	Inner []Deployer
}

func (m MultiDeployer) Deploy(ctx context.Context, names []string, certPEM, keyPEM []byte) error {
	var first error
	for _, d := range m.Inner {
		if d == nil {
			continue
		}
		if err := d.Deploy(ctx, names, certPEM, keyPEM); err != nil && first == nil {
			first = err
		}
	}
	return first
}

type BaotaDeployer struct {
	Panel  string
	Key    string
	Site   string
	HTTP   *http.Client
}

func BaotaFromEnv() *BaotaDeployer {
	panel := strings.TrimRight(strings.TrimSpace(os.Getenv("HA_BT_PANEL")), "/")
	key := strings.TrimSpace(os.Getenv("HA_BT_KEY"))
	if panel == "" || key == "" {
		return nil
	}
	site := strings.TrimSpace(os.Getenv("HA_BT_SSL_SITE"))
	return &BaotaDeployer{Panel: panel, Key: key, Site: site, HTTP: &http.Client{Timeout: 60 * time.Second}}
}

func siteCoveredByCert(site string, names []string) bool {
	site = strings.ToLower(strings.TrimSpace(site))
	if site == "" {
		return false
	}
	for _, n := range names {
		n = strings.ToLower(strings.TrimSpace(n))
		if n == site || n == "*."+site {
			return true
		}
	}
	return false
}

func (b *BaotaDeployer) Deploy(ctx context.Context, names []string, certPEM, keyPEM []byte) error {
	site := b.Site
	if site == "" {
		for _, n := range names {
			if !strings.HasPrefix(n, "*.") {
				site = n
				break
			}
		}
	}
	if site == "" && len(names) > 0 {
		site = strings.TrimPrefix(names[0], "*.")
	}
	if site == "" {
		return fmt.Errorf("宝塔 SetSSL 缺少站点名")
	}
	if !siteCoveredByCert(site, names) {
		return nil
	}
	_, err := b.post(ctx, "/site?action=SetSSL", url.Values{
		"type":     {"1"},
		"siteName": {site},
		"key":      {string(keyPEM)},
		"csr":      {string(certPEM)},
	})
	if err != nil {
		return fmt.Errorf("宝塔 SetSSL %s: %w", site, err)
	}
	_, _ = b.post(ctx, "/site?action=HttpToHttps", url.Values{"siteName": {site}})
	return nil
}

func (b *BaotaDeployer) post(ctx context.Context, path string, form url.Values) ([]byte, error) {
	now := strconv.FormatInt(time.Now().Unix(), 10)
	sum := md5.Sum([]byte(b.Key))
	tokenInner := md5.Sum([]byte(now + hex.EncodeToString(sum[:])))
	if form == nil {
		form = url.Values{}
	}
	form.Set("request_time", now)
	form.Set("request_token", hex.EncodeToString(tokenInner[:]))
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
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var wrap struct {
		Status *bool  `json:"status"`
		Msg    string `json:"msg"`
	}
	if json.Unmarshal(body, &wrap) == nil && wrap.Status != nil && !*wrap.Status {
		return body, fmt.Errorf("%s", wrap.Msg)
	}
	return body, nil
}

func DefaultDeployer() Deployer {
	inner := []Deployer{FileDeployer{Dir: TLSDir()}}
	if bt := BaotaFromEnv(); bt != nil {
		inner = append(inner, bt)
	}
	return MultiDeployer{Inner: inner}
}
