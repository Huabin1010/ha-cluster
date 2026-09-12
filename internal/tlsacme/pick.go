package tlsacme

import (
	"os"
	"strings"
)

func PickIssuer(accounts AccountStore) Issuer {
	if v := strings.TrimSpace(os.Getenv("HA_TLS_SELF_SIGNED")); v == "1" || strings.EqualFold(v, "true") {
		return SelfSignedIssuer{IssuerName: "self-signed"}
	}
	var dns DNSProvider
	if p := DNSPodFromEnv(); p != nil {
		dns = p
	} else if p := BaotaDNSFromEnv(); p != nil {
		dns = p
	}
	if dns == nil {
		return nil
	}
	return &ACMEIssuer{DNS: dns, Accounts: accounts, Directory: DirectoryURL(), Email: ACMEEmail(), Wait: DNSWait()}
}
