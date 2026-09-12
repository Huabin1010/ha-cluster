package tlsacme

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"os"
	"strings"
	"time"
)

type Bundle struct {
	CertPEM   []byte
	KeyPEM    []byte
	NotBefore time.Time
	NotAfter  time.Time
	Issuer    string
}

type Issuer interface {
	Issue(ctx context.Context, names []string) (*Bundle, error)
}

type DNSProvider interface {
	Present(ctx context.Context, fqdn, value string) error
	CleanUp(ctx context.Context, fqdn, value string) error
}

type Deployer interface {
	Deploy(ctx context.Context, names []string, certPEM, keyPEM []byte) error
}

func DirectoryURL() string {
	if v := strings.TrimSpace(os.Getenv("HA_ACME_DIRECTORY")); v != "" {
		return v
	}
	if staging := strings.TrimSpace(os.Getenv("HA_ACME_STAGING")); staging == "1" || strings.EqualFold(staging, "true") {
		return "https://acme-staging-v02.api.letsencrypt.org/directory"
	}
	return "https://acme-v02.api.letsencrypt.org/directory"
}

func ACMEEmail() string {
	if v := strings.TrimSpace(os.Getenv("HA_ACME_EMAIL")); v != "" {
		return v
	}
	return "admin@cl.qzsyzn.com"
}

func RenewWindow() time.Duration {
	return 30 * 24 * time.Hour
}

func DNSWait() time.Duration {
	if v := strings.TrimSpace(os.Getenv("HA_ACME_DNS_WAIT")); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			return d
		}
	}
	return 60 * time.Second
}

func RootDomain() string {
	return strings.ToLower(strings.TrimSpace(os.Getenv("HA_ACME_ROOT_DOMAIN")))
}

func TLSDir() string {
	if v := strings.TrimSpace(os.Getenv("HA_TLS_DIR")); v != "" {
		return v
	}
	return "/var/lib/ha-cluster/tls"
}

// SelfSignedIssuer is used in tests / when ACME DNS is not configured and HA_TLS_SELF_SIGNED=1.
type SelfSignedIssuer struct {
	IssuerName string
}

func (s SelfSignedIssuer) Issue(_ context.Context, names []string) (*Bundle, error) {
	names = NormalizeNames(names)
	if len(names) == 0 {
		return nil, fmt.Errorf("names 不能为空")
	}
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}
	now := time.Now().Add(-time.Hour)
	tpl := &x509.Certificate{
		SerialNumber:          big.NewInt(now.UnixNano()),
		Subject:               pkix.Name{CommonName: names[0], Organization: []string{"ha-cluster"}},
		NotBefore:             now,
		NotAfter:              now.Add(90 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              dnsNamesForCSR(names),
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		return nil, err
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	name := s.IssuerName
	if name == "" {
		name = "self-signed"
	}
	return &Bundle{CertPEM: certPEM, KeyPEM: keyPEM, NotBefore: tpl.NotBefore, NotAfter: tpl.NotAfter, Issuer: name}, nil
}

func dnsNamesForCSR(names []string) []string {
	var out []string
	for _, n := range names {
		out = append(out, n)
	}
	return out
}
