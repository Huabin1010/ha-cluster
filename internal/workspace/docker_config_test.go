package workspace

import (
	"encoding/json"
	"testing"

	"ha-cluster/internal/models"
)

func TestDockerConfigJSON(t *testing.T) {
	raw, err := dockerConfigJSON([]models.DockerRegistryCred{
		{Server: "docker.1ms.run", Username: "1ms", Password: "tok"},
	})
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]map[string]map[string]string
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	if m["auths"]["https://docker.1ms.run"]["auth"] == "" {
		t.Fatal("missing auth")
	}
}
