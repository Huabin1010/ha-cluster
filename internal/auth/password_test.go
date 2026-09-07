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

func TestHashPasswordUniqueSalts(t *testing.T) {
	a, _ := HashPassword("same")
	b, _ := HashPassword("same")
	if a == b {
		t.Fatal("hashes should differ due to salt")
	}
}
