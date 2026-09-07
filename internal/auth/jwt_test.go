package auth

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestSignAndParseAccess(t *testing.T) {
	secret := []byte("test-secret-32-bytes-minimum-ok")
	uid := uuid.New()
	tok, err := SignAccess(secret, uid, "alice", "platform_user", 3, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	c, err := ParseAccess(secret, tok)
	if err != nil {
		t.Fatal(err)
	}
	if c.UserID != uid || c.Username != "alice" || c.TokenVersion != 3 {
		t.Fatalf("claims mismatch: %+v", c)
	}
}

func TestParseAccessRejectsWrongSecret(t *testing.T) {
	uid := uuid.New()
	tok, _ := SignAccess([]byte("aaaaaaaaaaaaaaaa"), uid, "a", "platform_user", 1, time.Minute)
	if _, err := ParseAccess([]byte("bbbbbbbbbbbbbbbb"), tok); err == nil {
		t.Fatal("expected error")
	}
}

func TestParseAccessExpired(t *testing.T) {
	uid := uuid.New()
	tok, _ := SignAccess([]byte("aaaaaaaaaaaaaaaa"), uid, "a", "platform_user", 1, -time.Minute)
	if _, err := ParseAccess([]byte("aaaaaaaaaaaaaaaa"), tok); err == nil {
		t.Fatal("expected expired")
	}
}
