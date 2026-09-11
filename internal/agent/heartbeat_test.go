package agent

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPostHeartbeat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/nodes/heartbeat" {
			t.Fatalf("path %s", r.URL.Path)
		}
		var st Status
		_ = json.NewDecoder(r.Body).Decode(&st)
		if st.Name != "n1" {
			t.Fatalf("%+v", st)
		}
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()
	st := DetectStatus("n1", "10.88.0.9", 1000, 1<<30, 10<<30)
	if err := PostHeartbeat(srv.Client(), srv.URL, st); err != nil {
		t.Fatal(err)
	}
}

func TestStatusJSONIncludesHostTotals(t *testing.T) {
	st := Status{
		Name:              "n1",
		MemTotalBytes:     100,
		DiskTotalBytes:    200,
		MemAvailableBytes: 40,
		DiskFreeBytes:     80,
	}
	b, err := json.Marshal(st)
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	for _, want := range []string{`"mem_total_bytes":100`, `"disk_total_bytes":200`} {
		if !strings.Contains(s, want) {
			t.Fatalf("missing %s in %s", want, s)
		}
	}
}
