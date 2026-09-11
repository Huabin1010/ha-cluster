package auth

import "testing"

func TestHashAndVerifyPassword(t *testing.T) {
	h, err := HashPassword("s3cret!")
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword("s3cret!", h) {
		t.Fatal("expected match")
	}
	if VerifyPassword("wrong", h) {
		t.Fatal("expected mismatch")
	}
	if VerifyPassword("s3cret!", "not-a-hash") {
		t.Fatal("garbage should not verify")
	}
}

func TestRandomPassword(t *testing.T) {
	a, err := RandomPassword(12)
	if err != nil {
		t.Fatal(err)
	}
	b, err := RandomPassword(12)
	if err != nil {
		t.Fatal(err)
	}
	if len(a) != 12 || len(b) != 12 {
		t.Fatalf("len a=%d b=%d", len(a), len(b))
	}
	if a == b {
		t.Fatal("random passwords should differ")
	}
}

func TestHashPasswordUniqueSalts(t *testing.T) {
	a, _ := HashPassword("same")
	b, _ := HashPassword("same")
	if a == b {
		t.Fatal("hashes should differ due to salt")
	}
}
