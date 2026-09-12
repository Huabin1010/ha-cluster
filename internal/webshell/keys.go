package webshell

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"os"
	"strings"
	"sync"

	"golang.org/x/crypto/ssh"
)

var (
	once   sync.Once
	signer ssh.Signer
	pub    string
)

func ensure() {
	once.Do(func() {
		if path := strings.TrimSpace(os.Getenv("HA_WEBSHELL_KEY_FILE")); path != "" {
			if loadFromFile(path) {
				return
			}
		}
		_, priv, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return
		}
		s, err := ssh.NewSignerFromKey(priv)
		if err != nil {
			return
		}
		signer = s
		pub = strings.TrimSpace(string(ssh.MarshalAuthorizedKey(s.PublicKey())))
	})
}

func loadFromFile(path string) bool {
	raw, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	// OpenSSH private key or PEM.
	if s, err := ssh.ParsePrivateKey(raw); err == nil {
		signer = s
		pub = strings.TrimSpace(string(ssh.MarshalAuthorizedKey(s.PublicKey())))
		return true
	}
	block, _ := pem.Decode(raw)
	if block == nil {
		return false
	}
	s, err := ssh.ParsePrivateKey(raw)
	if err != nil {
		return false
	}
	signer = s
	pub = strings.TrimSpace(string(ssh.MarshalAuthorizedKey(s.PublicKey())))
	return true
}

// AuthorizedKey is the control-plane key injected into workspaces for Web 终端 / Bastion.
func AuthorizedKey() string {
	ensure()
	return pub
}

func Signer() ssh.Signer {
	ensure()
	return signer
}
