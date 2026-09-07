package agent

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
