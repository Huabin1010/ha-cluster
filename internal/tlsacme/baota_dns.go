package tlsacme

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// BaotaDNS uses the panel DNSPod plugin to publish ACME TXT records.
type BaotaDNS struct {
	BT         *BaotaDeployer
	RootDomain string
}

func BaotaDNSFromEnv() *BaotaDNS {
	bt := BaotaFromEnv()
	if bt == nil {
		return nil
	}
	return &BaotaDNS{BT: bt, RootDomain: RootDomain()}
}

func (d *BaotaDNS) Present(ctx context.Context, fqdn, value string) error {
	domain, sub := SplitRecord(fqdn, d.RootDomain)
	_, err := d.BT.post(ctx, "/plugin?action=a&name=dnspod&s=create_record", url.Values{
		"domain":     {domain},
		"subDomain":  {sub},
		"recordType": {"TXT"},
		"recordLine": {"默认"},
		"value":      {value},
		"ttl":        {"600"},
		"mx":         {"0"},
	})
	return err
}

func (d *BaotaDNS) CleanUp(ctx context.Context, fqdn, value string) error {
	domain, sub := SplitRecord(fqdn, d.RootDomain)
	raw, err := d.BT.post(ctx, "/plugin?action=a&name=dnspod&s=get_record_list", url.Values{
		"domain": {domain},
	})
	if err != nil {
		return err
	}
	var wrap struct {
		Data []struct {
			ID    any    `json:"id"`
			Name  string `json:"name"`
			Type  string `json:"type"`
			Value string `json:"value"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &wrap) != nil {
		return nil
	}
	for _, rec := range wrap.Data {
		if !strings.EqualFold(rec.Type, "TXT") {
			continue
		}
		if rec.Name != sub && rec.Name != fqdn {
			continue
		}
		if rec.Value != value && rec.Value != `"`+value+`"` {
			continue
		}
		_, _ = d.BT.post(ctx, "/plugin?action=a&name=dnspod&s=delete_record", url.Values{
			"domain":   {domain},
			"recordId": {fmt.Sprint(asRecordID(rec.ID))},
		})
	}
	return nil
}

func asRecordID(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return strconv.FormatInt(int64(t), 10)
	default:
		return fmt.Sprint(v)
	}
}
