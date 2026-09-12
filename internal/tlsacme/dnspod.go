package tlsacme

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

type DNSPod struct {
	Token      string
	RootDomain string
	HTTP       *http.Client
}

func DNSPodFromEnv() *DNSPod {
	id := strings.TrimSpace(os.Getenv("HA_DNSPOD_ID"))
	tok := strings.TrimSpace(os.Getenv("HA_DNSPOD_TOKEN"))
	combo := strings.TrimSpace(os.Getenv("HA_DNSPOD_LOGIN_TOKEN"))
	if combo == "" && id != "" && tok != "" {
		combo = id + "," + tok
	}
	if combo == "" {
		return nil
	}
	return &DNSPod{Token: combo, RootDomain: RootDomain(), HTTP: &http.Client{Timeout: 20 * time.Second}}
}

func (d *DNSPod) Present(ctx context.Context, fqdn, value string) error {
	domain, sub := SplitRecord(fqdn, d.RootDomain)
	_, err := d.call(ctx, "Record.Create", url.Values{
		"domain":      {domain},
		"sub_domain":  {sub},
		"record_type": {"TXT"},
		"record_line": {"默认"},
		"value":       {value},
		"ttl":         {"600"},
	})
	return err
}

func (d *DNSPod) CleanUp(ctx context.Context, fqdn, value string) error {
	domain, sub := SplitRecord(fqdn, d.RootDomain)
	raw, err := d.call(ctx, "Record.List", url.Values{
		"domain":         {domain},
		"sub_domain":     {sub},
		"record_type":    {"TXT"},
	})
	if err != nil {
		return err
	}
	var out struct {
		Records []struct {
			ID    string `json:"id"`
			Value string `json:"value"`
			Name  string `json:"name"`
		} `json:"records"`
	}
	if json.Unmarshal(raw, &out) != nil {
		return nil
	}
	for _, rec := range out.Records {
		if rec.Value != value && rec.Value != `"`+value+`"` {
			continue
		}
		_, _ = d.call(ctx, "Record.Remove", url.Values{"domain": {domain}, "record_id": {rec.ID}})
	}
	return nil
}

func (d *DNSPod) call(ctx context.Context, api string, form url.Values) ([]byte, error) {
	if form == nil {
		form = url.Values{}
	}
	form.Set("login_token", d.Token)
	form.Set("format", "json")
	form.Set("lang", "cn")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://dnsapi.cn/"+api, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	client := d.HTTP
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
		Status struct {
			Code string `json:"code"`
			Msg  string `json:"message"`
		} `json:"status"`
	}
	_ = json.Unmarshal(body, &wrap)
	if wrap.Status.Code != "" && wrap.Status.Code != "1" {
		return body, fmt.Errorf("dnspod %s: %s %s", api, wrap.Status.Code, wrap.Status.Msg)
	}
	return body, nil
}
