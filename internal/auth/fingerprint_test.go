package auth

import (
	"net/http/httptest"
	"testing"
)

func TestDeviceFingerprintStable(t *testing.T) {
	r1 := httptest.NewRequest("GET", "/", nil)
	r1.Header.Set("User-Agent", "TestAgent/1.0")
	r1.RemoteAddr = "203.0.113.10:1234"
	fp1 := DeviceFingerprint(r1)

	r2 := httptest.NewRequest("GET", "/", nil)
	r2.Header.Set("User-Agent", "TestAgent/1.0")
	r2.RemoteAddr = "203.0.113.99:5678"
	fp2 := DeviceFingerprint(r2)

	if fp1 != fp2 {
		t.Fatalf("same subnet UA should match: %s vs %s", fp1, fp2)
	}

	r3 := httptest.NewRequest("GET", "/", nil)
	r3.Header.Set("User-Agent", "Other/2.0")
	r3.RemoteAddr = "203.0.113.10:1234"
	fp3 := DeviceFingerprint(r3)
	if fp1 == fp3 {
		t.Fatal("different UA should differ")
	}
}
