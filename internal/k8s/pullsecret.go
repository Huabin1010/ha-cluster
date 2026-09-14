package k8s

import (
	"encoding/base64"
	"encoding/json"
	"fmt"

	"ha-cluster/internal/models"
)

// PullSecretName is the dockerconfigjson Secret applied into every k8s workspace namespace.
const PullSecretName = "ha-registry"

func dockerConfigJSON(regs []models.DockerRegistryCred) ([]byte, error) {
	auths := map[string]map[string]string{}
	for _, reg := range regs {
		if reg.Server == "" {
			continue
		}
		auth := base64.StdEncoding.EncodeToString([]byte(reg.Username + ":" + reg.Password))
		auths["https://"+reg.Server] = map[string]string{"auth": auth}
		auths[reg.Server] = map[string]string{"auth": auth}
	}
	return json.Marshal(map[string]any{"auths": auths})
}

func pullSecretYAML(ns string, regs []models.DockerRegistryCred) (string, error) {
	raw, err := dockerConfigJSON(regs)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf(`apiVersion: v1
kind: Secret
metadata:
  name: %s
  namespace: %s
type: kubernetes.io/dockerconfigjson
data:
  .dockerconfigjson: %s
`, PullSecretName, ns, base64.StdEncoding.EncodeToString(raw)), nil
}

func defaultServiceAccountYAML(ns string) string {
	return fmt.Sprintf(`apiVersion: v1
kind: ServiceAccount
metadata:
  name: default
  namespace: %s
imagePullSecrets:
- name: %s
`, ns, PullSecretName)
}
