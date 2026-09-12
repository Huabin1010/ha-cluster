package webshell

import (
	"bytes"
	"strings"
	"testing"
)

func TestFakeRunIncludesStdin(t *testing.T) {
	out, errb, exit := FakeRun("cat", []byte("hello"))
	if exit != 0 || string(errb) != "" {
		t.Fatalf("exit=%d stderr=%q", exit, errb)
	}
	if string(out) != "cat\nhello" {
		t.Fatalf("stdout %q", out)
	}
}

func TestCapBufferTruncates(t *testing.T) {
	var c capBuffer
	c.limit = 8
	_, _ = c.Write([]byte("abcdefghijkl"))
	got := string(c.bytes())
	if !strings.HasPrefix(got, "abcdefgh") || !strings.Contains(got, "truncated") {
		t.Fatalf("got %q", got)
	}
	if !c.hit {
		t.Fatal("expected hit")
	}
}

func TestCapBufferPassthrough(t *testing.T) {
	var c capBuffer
	c.limit = 64
	n, err := c.Write([]byte("ok"))
	if err != nil || n != 2 {
		t.Fatalf("write %d %v", n, err)
	}
	if !bytes.Equal(c.bytes(), []byte("ok")) {
		t.Fatalf("bytes %q", c.bytes())
	}
}
