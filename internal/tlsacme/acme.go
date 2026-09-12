package tlsacme

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"log"
	"strings"
	"time"

	"golang.org/x/crypto/acme"

	"ha-cluster/internal/models"
)

type AccountStore interface {
	GetACMEAccount(ctx context.Context) (*models.ACMEAccount, error)
	SaveACMEAccount(ctx context.Context, acc *models.ACMEAccount) error
}

type ACMEIssuer struct {
	Directory string
	Email     string
	DNS       DNSProvider
	Accounts  AccountStore
	Wait      time.Duration
}

func (a *ACMEIssuer) Issue(ctx context.Context, names []string) (*Bundle, error) {
	names = NormalizeNames(names)
	if len(names) == 0 {
		return nil, fmt.Errorf("names 不能为空")
	}
	if a.DNS == nil {
		return nil, fmt.Errorf("未配置 ACME DNS 提供商（HA_DNSPOD_ID / HA_DNSPOD_TOKEN）")
	}
	dir := a.Directory
	if dir == "" {
		dir = DirectoryURL()
	}
	email := a.Email
	if email == "" {
		email = ACMEEmail()
	}
	client, err := a.client(ctx, dir, email)
	if err != nil {
		return nil, err
	}
	order, err := client.AuthorizeOrder(ctx, acme.DomainIDs(names...))
	if err != nil {
		return nil, fmt.Errorf("acme new order: %w", err)
	}
	for _, u := range order.AuthzURLs {
		az, err := client.GetAuthorization(ctx, u)
		if err != nil {
			return nil, fmt.Errorf("acme authz: %w", err)
		}
		if az.Status == acme.StatusValid {
			continue
		}
		chal := dnsChallenge(az)
		if chal == nil {
			return nil, fmt.Errorf("acme: %s 没有 DNS-01 挑战", az.Identifier.Value)
		}
		val, err := client.DNS01ChallengeRecord(chal.Token)
		if err != nil {
			return nil, err
		}
		fqdn := ChallengeHost(az.Identifier.Value)
		if err := a.DNS.Present(ctx, fqdn, val); err != nil {
			return nil, fmt.Errorf("dns present %s: %w", fqdn, err)
		}
		defer func(fqdn, val string) { _ = a.DNS.CleanUp(context.Background(), fqdn, val) }(fqdn, val)
		wait := a.Wait
		if wait <= 0 {
			wait = DNSWait()
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(wait):
		}
		if _, err := client.Accept(ctx, chal); err != nil {
			return nil, fmt.Errorf("acme accept: %w", err)
		}
		if _, err := client.WaitAuthorization(ctx, az.URI); err != nil {
			return nil, fmt.Errorf("acme wait authz %s: %w", az.Identifier.Value, err)
		}
	}
	if _, err := client.WaitOrder(ctx, order.URI); err != nil && !strings.Contains(err.Error(), "ready") {
		// some CAs already mark ready; continue to finalize
		log.Printf("acme wait order: %v", err)
	}
	csrDER, keyPEM, err := newOrderCSR(names)
	if err != nil {
		return nil, err
	}
	der, _, err := client.CreateOrderCert(ctx, order.FinalizeURL, csrDER, true)
	if err != nil {
		if ready, gerr := client.GetOrder(ctx, order.URI); gerr == nil && ready.Status == acme.StatusValid && ready.CertURL != "" {
			der, err = client.FetchCert(ctx, ready.CertURL, true)
		}
		if err != nil {
			return nil, fmt.Errorf("acme finalize: %w", err)
		}
	}
	var certPEM []byte
	var leaf *x509.Certificate
	for i, c := range der {
		block := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: c})
		certPEM = append(certPEM, block...)
		if i == 0 {
			leaf, _ = x509.ParseCertificate(c)
		}
	}
	b := &Bundle{CertPEM: certPEM, KeyPEM: keyPEM, Issuer: "letsencrypt"}
	if leaf != nil {
		b.NotBefore = leaf.NotBefore
		b.NotAfter = leaf.NotAfter
		if len(leaf.Issuer.Organization) > 0 {
			b.Issuer = leaf.Issuer.Organization[0]
		} else if leaf.Issuer.CommonName != "" {
			b.Issuer = leaf.Issuer.CommonName
		}
	}
	return b, nil
}

func (a *ACMEIssuer) client(ctx context.Context, dir, email string) (*acme.Client, error) {
	key, accURL, err := a.loadOrCreateKey(ctx, dir, email)
	if err != nil {
		return nil, err
	}
	c := &acme.Client{Key: key, DirectoryURL: dir}
	if accURL == "" {
		acct, err := c.Register(ctx, &acme.Account{Contact: []string{"mailto:" + email}}, acme.AcceptTOS)
		if err != nil {
			return nil, fmt.Errorf("acme register: %w", err)
		}
		if a.Accounts != nil {
			_ = a.Accounts.SaveACMEAccount(ctx, &models.ACMEAccount{Directory: dir, Email: email, KeyPEM: encodeECDSA(key), URL: acct.URI})
		}
	}
	return c, nil
}

func (a *ACMEIssuer) loadOrCreateKey(ctx context.Context, dir, email string) (*ecdsa.PrivateKey, string, error) {
	if a.Accounts != nil {
		if acc, err := a.Accounts.GetACMEAccount(ctx); err == nil && acc != nil && acc.KeyPEM != "" && acc.Directory == dir {
			k, err := parseECDSA(acc.KeyPEM)
			if err == nil {
				return k, acc.URL, nil
			}
		}
	}
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, "", err
	}
	if a.Accounts != nil {
		_ = a.Accounts.SaveACMEAccount(ctx, &models.ACMEAccount{Directory: dir, Email: email, KeyPEM: encodeECDSA(k)})
	}
	return k, "", nil
}

func dnsChallenge(az *acme.Authorization) *acme.Challenge {
	for _, c := range az.Challenges {
		if c.Type == "dns-01" {
			return c
		}
	}
	return nil
}

func newOrderCSR(names []string) (csrDER, keyPEM []byte, err error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	tpl := &x509.CertificateRequest{
		Subject:  pkix.Name{CommonName: names[0]},
		DNSNames: dnsNamesForCSR(names),
	}
	csrDER, err = x509.CreateCertificateRequest(rand.Reader, tpl, key)
	if err != nil {
		return nil, nil, err
	}
	der, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return nil, nil, err
	}
	keyPEM = pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: der})
	return csrDER, keyPEM, nil
}

func encodeECDSA(k *ecdsa.PrivateKey) string {
	der, err := x509.MarshalECPrivateKey(k)
	if err != nil {
		return ""
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: der}))
}

func parseECDSA(pemStr string) (*ecdsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(pemStr))
	if block == nil {
		return nil, fmt.Errorf("invalid account key pem")
	}
	return x509.ParseECPrivateKey(block.Bytes)
}

var _ crypto.Signer = (*ecdsa.PrivateKey)(nil)
