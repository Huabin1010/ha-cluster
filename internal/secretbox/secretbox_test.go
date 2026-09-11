package secretbox

import "testing"

func TestEncryptDecrypt(t *testing.T) {
	key := []byte("unit-test-secret-key-32b!!")
	enc, err := Encrypt(key, "s3cr3t")
	if err != nil {
		t.Fatal(err)
	}
	plain, err := Decrypt(key, enc)
	if err != nil {
		t.Fatal(err)
	}
	if plain != "s3cr3t" {
		t.Fatalf("got %q", plain)
	}
}
