// Package edge attaches user-owned (CNAME-verified) domains to the public
// entry point and gets HTTPS certificates for them.
//
// The entry point is pluggable: production uses the Baota panel on 42
// (TLS terminates there, then plain HTTP to the compose edge Nginx). To move
// the 443 edge elsewhere later, add another CustomDomainEdge implementation
// and select it with HA_EDGE_PROVIDER.
package edge

import (
	"context"
	"os"
	"strings"
	"sync"
	"time"
)

// CertInfo is what the edge reports after issuing a certificate.
type CertInfo struct {
	Issuer   string
	NotAfter *time.Time
}

// CustomDomainEdge is implemented by every public entry provider.
// All methods must be idempotent: the verifier may call them repeatedly.
type CustomDomainEdge interface {
	// Name identifies the provider in audit logs and the API.
	Name() string
	// Attach makes the edge accept HTTP for domain and forward it to the
	// ingress Nginx (which routes by Host to the workspace).
	Attach(ctx context.Context, domain string) error
	// IssueCert obtains and installs an HTTPS certificate for domain.
	// DNS must already point at the edge (HTTP-01).
	IssueCert(ctx context.Context, domain string) (CertInfo, error)
	// Detach removes the domain and its certificate from the edge.
	Detach(ctx context.Context, domain string) error
}

// FromEnv picks the provider. HA_EDGE_PROVIDER=baota needs HA_BT_PANEL and
// HA_BT_KEY; anything else (including empty) is the no-op provider used for
// local development, where the ingress Nginx serves HTTP directly.
func FromEnv() CustomDomainEdge {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("HA_EDGE_PROVIDER"))) {
	case "baota":
		if b := BaotaFromEnv(); b != nil {
			return b
		}
	}
	return NoopEdge{}
}

// NoopEdge does nothing and reports no certificate. Used in dev/lab.
type NoopEdge struct{}

func (NoopEdge) Name() string                                        { return "noop" }
func (NoopEdge) Attach(context.Context, string) error                { return nil }
func (NoopEdge) Detach(context.Context, string) error                { return nil }
func (NoopEdge) IssueCert(context.Context, string) (CertInfo, error) { return CertInfo{}, ErrNoTLS }

// ErrNoTLS means the provider does not manage certificates (HTTP only).
var ErrNoTLS = errNoTLS{}

type errNoTLS struct{}

func (errNoTLS) Error() string {
	return "当前入口未启用自动 HTTPS（HA_EDGE_PROVIDER 未设为 baota）"
}

// FakeEdge records calls for tests. Set the *Err fields to inject failures.
type FakeEdge struct {
	mu        sync.Mutex
	Calls     []string
	AttachErr error
	IssueErr  error
	DetachErr error
	Attached  map[string]bool
}

func (f *FakeEdge) Name() string { return "fake" }

func (f *FakeEdge) record(op, domain string) {
	f.Calls = append(f.Calls, op+":"+domain)
}

func (f *FakeEdge) Attach(_ context.Context, domain string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.record("attach", domain)
	if f.AttachErr != nil {
		return f.AttachErr
	}
	if f.Attached == nil {
		f.Attached = map[string]bool{}
	}
	f.Attached[domain] = true
	return nil
}

func (f *FakeEdge) IssueCert(_ context.Context, domain string) (CertInfo, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.record("issue", domain)
	if f.IssueErr != nil {
		return CertInfo{}, f.IssueErr
	}
	na := time.Now().Add(90 * 24 * time.Hour)
	return CertInfo{Issuer: "fake", NotAfter: &na}, nil
}

func (f *FakeEdge) Detach(_ context.Context, domain string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.record("detach", domain)
	if f.DetachErr != nil {
		return f.DetachErr
	}
	delete(f.Attached, domain)
	return nil
}

// Count returns how many times op ("attach", "issue", "detach") ran for domain.
func (f *FakeEdge) Count(op, domain string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, c := range f.Calls {
		if c == op+":"+domain {
			n++
		}
	}
	return n
}
