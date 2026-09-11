package webshell

import (
	"crypto/ed25519"
	"crypto/rand"
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

// AuthorizedKey is the control-plane key injected into workspaces for Web 终端.
func AuthorizedKey() string {
	ensure()
	return pub
}

func Signer() ssh.Signer {
	ensure()
	return signer
}
