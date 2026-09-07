package bastion

import (
	"bytes"
	"io"
	"net"
	"testing"
	"time"
)

func TestDialProxy(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		defer c.Close()
		buf := make([]byte, 4)
		_, _ = io.ReadFull(c, buf)
		_, _ = c.Write([]byte("pong"))
	}()
	in := bytes.NewReader([]byte("ping"))
	var out bytes.Buffer
	if err := DialProxy(ln.Addr().String(), in, &out, 2*time.Second); err != nil {
		t.Fatal(err)
	}
	if out.String() != "pong" {
		t.Fatalf("%q", out.String())
	}
}
