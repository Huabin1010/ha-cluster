package webshell

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestPipeEchoRoundTrip(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close(websocket.StatusNormalClosure, "")
		PipeEcho(r.Context(), c, "banner\r\n")
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	u := "ws" + strings.TrimPrefix(srv.URL, "http")
	c, _, err := websocket.Dial(ctx, u, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close(websocket.StatusNormalClosure, "")

	_, data, err := c.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "banner\r\n" {
		t.Fatalf("banner %q", data)
	}
	if err := c.Write(ctx, websocket.MessageText, []byte(`{"type":"resize","cols":80,"rows":24}`)); err != nil {
		t.Fatal(err)
	}
	if err := c.Write(ctx, websocket.MessageBinary, []byte("hi")); err != nil {
		t.Fatal(err)
	}
	_, echo, err := c.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if string(echo) != "hi" {
		t.Fatalf("echo %q", echo)
	}
}

func TestAuthorizedKey(t *testing.T) {
	k := AuthorizedKey()
	if !strings.HasPrefix(k, "ssh-ed25519 ") {
		t.Fatalf("authorized key %q", k)
	}
	if Signer() == nil {
		t.Fatal("signer nil")
	}
}
