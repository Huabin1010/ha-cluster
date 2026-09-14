package k8s

import (
	"errors"
	"testing"

	"ha-cluster/internal/models"
)

func TestNewFromEnvMemoryOnlyWhenAllowed(t *testing.T) {
	t.Setenv("HA_KUBECONFIG", "")
	t.Setenv("HA_K8S_MEMORY", "")
	if _, ok := NewFromEnv().(Unavailable); !ok {
		t.Fatal("want Unavailable when kubeconfig and memory flag unset")
	}
	t.Setenv("HA_K8S_MEMORY", "1")
	if _, ok := NewFromEnv().(*Memory); !ok {
		t.Fatal("want Memory when HA_K8S_MEMORY=1")
	}
}

func TestUnavailableErrors(t *testing.T) {
	c := Unavailable{}
	if err := c.Available(t.Context()); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("Available: %v", err)
	}
	if _, _, err := c.Provision(t.Context(), models.Workspace{}, "x"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("Provision: %v", err)
	}
}
