package api

import (
	"strings"
	"testing"
)

func TestClipAuditRunes(t *testing.T) {
	got, cut := clipAuditRunes("abc", 10)
	if got != "abc" || cut {
		t.Fatalf("short: %q %v", got, cut)
	}
	long := strings.Repeat("汉", 5)
	got, cut = clipAuditRunes(long, 3)
	if got != "汉汉汉…" || !cut {
		t.Fatalf("clip: %q %v", got, cut)
	}
	out, outCut := clipAuditBytes([]byte("hello"), 4)
	if out != "hell…" || !outCut {
		t.Fatalf("bytes: %q %v", out, outCut)
	}
}

func TestExecAuditMetaKeepsStdout(t *testing.T) {
	meta := execAuditMeta("uname -a", []byte("Linux box\n"), []byte("warn"), 0, map[string]any{
		"username": "admin",
	})
	if meta["command"] != "uname -a" || meta["stdout"] != "Linux box\n" || meta["stderr"] != "warn" {
		t.Fatalf("%v", meta)
	}
	if meta["exit_code"] != 0 || meta["username"] != "admin" {
		t.Fatalf("%v", meta)
	}
}
