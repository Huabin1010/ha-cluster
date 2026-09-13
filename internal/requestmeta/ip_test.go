package requestmeta

import (
	"net/http/httptest"
	"testing"
)

func TestFromRequestPrefersPublicXFFBehindDocker(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "172.28.90.1:54321"
	r.Header.Set("X-Real-IP", "172.28.90.1")
	r.Header.Set("X-Forwarded-For", "203.0.113.50, 172.28.90.1")
	if got := FromRequest(r); got != "203.0.113.50" {
		t.Fatalf("got %q", got)
	}
}

func TestFromRequestIgnoresSpoofedLeftmostWhenPeerIsPublic(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "198.51.100.20:443"
	r.Header.Set("X-Forwarded-For", "8.8.8.8")
	r.Header.Set("X-Real-IP", "8.8.8.8")
	if got := FromRequest(r); got != "198.51.100.20" {
		t.Fatalf("got %q", got)
	}
}

func TestFromRequestSkipsSpoofBeforeTrustedProxy(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "127.0.0.1:18080"
	r.Header.Set("X-Forwarded-For", "8.8.8.8, 203.0.113.9")
	r.Header.Set("X-Real-IP", "127.0.0.1")
	if got := FromRequest(r); got != "203.0.113.9" {
		t.Fatalf("got %q", got)
	}
}

func TestFromRequestBareRemoteAddr(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "192.0.2.1:1234"
	if got := FromRequest(r); got != "192.0.2.1" {
		t.Fatalf("got %q", got)
	}
}
