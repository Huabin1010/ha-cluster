package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/google/uuid"

	"ha-cluster/internal/bastion"
	"ha-cluster/internal/models"
)

func TestFetchTargetInternalToken(t *testing.T) {
	internalToken := "test-internal-token"
	_ = os.Setenv("HA_INTERNAL_TOKEN", internalToken)
	defer os.Unsetenv("HA_INTERNAL_TOKEN")

	ownerID := uuid.New()
	devID := uuid.New()
	wsID := uuid.New()

	var respPayload map[string]any
	respStatusCode := http.StatusOK

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-HA-Internal") != internalToken {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		if respStatusCode != http.StatusOK {
			http.Error(w, `{"error":"forbidden"}`, respStatusCode)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(respPayload)
	}))
	defer srv.Close()

	// 1. Shared workspace access by developer -> should succeed
	respPayload = map[string]any{
		"workspace_id":    wsID,
		"node":            "node1",
		"host":            "10.88.0.5",
		"port":            22005,
		"fabric_ip":       "10.88.0.5",
		"visibility":      models.VisShared,
		"owner_user_id":   ownerID,
		"actor_user_id":   devID,
		"membership_role": models.RoleDeveloper,
		"is_admin":        false,
		"via":             "fabric",
	}
	host, port, via, err := fetchTarget(srv.URL, "devuser", wsID.String())
	if err != nil {
		t.Fatalf("expected success, got error: %v", err)
	}
	if host != "10.88.0.5" || port != 22005 || via != "fabric" {
		t.Fatalf("unexpected target: host=%s, port=%d, via=%s", host, port, via)
	}

	// 2. Private workspace access by unauthorized developer -> must be DENIED by bastion client
	respPayload["visibility"] = models.VisPrivate
	respPayload["actor_user_id"] = devID
	respPayload["is_admin"] = false
	respPayload["membership_role"] = models.RoleDeveloper
	_, _, _, err = fetchTarget(srv.URL, "devuser", wsID.String())
	if !errors.Is(err, bastion.ErrDenied) {
		t.Fatalf("expected bastion.ErrDenied for unauthorized dev on private ws, got: %v", err)
	}

	// 3. Private workspace access by owner -> should succeed
	respPayload["actor_user_id"] = ownerID
	host, port, via, err = fetchTarget(srv.URL, "owneruser", wsID.String())
	if err != nil {
		t.Fatalf("expected owner success, got error: %v", err)
	}
	if host != "10.88.0.5" || port != 22005 {
		t.Fatalf("unexpected target for owner: host=%s, port=%d", host, port)
	}

	// 4. Private workspace access by project admin -> should succeed
	respPayload["actor_user_id"] = devID
	respPayload["membership_role"] = models.RoleAdmin
	host, port, via, err = fetchTarget(srv.URL, "adminuser", wsID.String())
	if err != nil {
		t.Fatalf("expected admin success, got error: %v", err)
	}
	if host != "10.88.0.5" || port != 22005 {
		t.Fatalf("unexpected target for admin: host=%s, port=%d", host, port)
	}

	// 5. Private workspace access by platform admin -> should succeed
	respPayload["actor_user_id"] = devID
	respPayload["membership_role"] = models.RoleDeveloper
	respPayload["is_admin"] = true
	host, port, via, err = fetchTarget(srv.URL, "platformadmin", wsID.String())
	if err != nil {
		t.Fatalf("expected platform admin success, got error: %v", err)
	}
	if host != "10.88.0.5" || port != 22005 {
		t.Fatalf("unexpected target for platform admin: host=%s, port=%d", host, port)
	}

	// 6. Server returns 403 Forbidden
	respStatusCode = http.StatusForbidden
	_, _, _, err = fetchTarget(srv.URL, "devuser", wsID.String())
	if err == nil {
		t.Fatal("expected error on 403 response, got nil")
	}
}
