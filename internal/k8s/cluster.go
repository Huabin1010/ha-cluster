package k8s

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"

	"github.com/google/uuid"
	"gopkg.in/yaml.v3"

	"ha-cluster/internal/models"
)

// ErrUnavailable means the control plane has no live apiserver (no HA_KUBECONFIG / kubectl failed).
var ErrUnavailable = errors.New("K8S_UNAVAILABLE")

type Resource struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
}

type Cluster interface {
	Available(ctx context.Context) error
	Provision(ctx context.Context, w models.Workspace, slug string) (ns, kubeconfig string, err error)
	Apply(ctx context.Context, ns, yamlText string) ([]Resource, error)
	Resources(ctx context.Context, ns string) ([]Resource, error)
	Delete(ctx context.Context, ns, kind, name string) error
	DestroyNS(ctx context.Context, ns string) error
	Kubeconfig(ns string) (string, error)
	ServiceNodePort(ctx context.Context, ns string, port int) (int, error)
	SyncPullSecrets(ctx context.Context, ns string, regs []models.DockerRegistryCred) error
}

func NamespaceName(slug string, id uuid.UUID) string {
	slug = strings.ToLower(strings.TrimSpace(slug))
	var b strings.Builder
	for _, r := range slug {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			b.WriteRune(r)
		}
	}
	s := strings.Trim(b.String(), "-")
	if s == "" {
		s = "ws"
	}
	if len(s) > 20 {
		s = s[:20]
	}
	short := strings.ReplaceAll(id.String(), "-", "")
	if len(short) > 8 {
		short = short[:8]
	}
	return "proj-" + s + "-" + short
}

func FakeKubeconfig(ns string) string {
	return fmt.Sprintf(`apiVersion: v1
kind: Config
clusters:
- cluster: { server: https://k8s.invalid }
  name: ha
contexts:
- context: { cluster: ha, namespace: %s, user: ha }
  name: ha
current-context: ha
users:
- name: ha
  user: { token: memory }
`, ns)
}

func memoryAllowed() bool {
	v := strings.TrimSpace(os.Getenv("HA_K8S_MEMORY"))
	return v == "1" || strings.EqualFold(v, "true") || strings.EqualFold(v, "yes")
}

type Memory struct {
	mu     sync.Mutex
	ns     map[string]map[string]Resource // ns -> kind/name
	kube   map[string]string
	quotas map[string]map[string]string
	pull   map[string][]models.DockerRegistryCred
}

func NewMemory() *Memory {
	return &Memory{
		ns:     map[string]map[string]Resource{},
		kube:   map[string]string{},
		quotas: map[string]map[string]string{},
		pull:   map[string][]models.DockerRegistryCred{},
	}
}

func (m *Memory) Available(context.Context) error { return nil }

func (m *Memory) Provision(_ context.Context, w models.Workspace, slug string) (string, string, error) {
	ns := NamespaceName(slug, w.ID)
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.ns[ns] == nil {
		m.ns[ns] = map[string]Resource{}
	}
	m.quotas[ns] = QuotaFromPlan(w.CPUMilli, w.MemBytes)
	kc := FakeKubeconfig(ns)
	m.kube[ns] = kc
	return ns, kc, nil
}

func (m *Memory) Apply(_ context.Context, ns, yamlText string) ([]Resource, error) {
	objs, err := SplitAndSanitize(yamlText, ns)
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.ns[ns] == nil {
		m.ns[ns] = map[string]Resource{}
	}
	var out []Resource
	for _, o := range objs {
		key := strings.ToLower(o.Kind) + "/" + o.Name
		res := Resource{Kind: o.Kind, Name: o.Name, Namespace: ns}
		m.ns[ns][key] = res
		out = append(out, res)
	}
	return out, nil
}

func (m *Memory) Resources(_ context.Context, ns string) ([]Resource, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Resource
	for _, r := range m.ns[ns] {
		out = append(out, r)
	}
	return out, nil
}

func (m *Memory) Delete(_ context.Context, ns, kind, name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.ns[ns] == nil {
		return fmt.Errorf("namespace 不存在")
	}
	delete(m.ns[ns], strings.ToLower(kind)+"/"+name)
	return nil
}

func (m *Memory) DestroyNS(_ context.Context, ns string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.ns, ns)
	delete(m.kube, ns)
	delete(m.quotas, ns)
	delete(m.pull, ns)
	return nil
}

func (m *Memory) Kubeconfig(ns string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	kc := m.kube[ns]
	if kc == "" {
		return "", fmt.Errorf("kubeconfig 不存在")
	}
	return kc, nil
}

func (m *Memory) ServiceNodePort(_ context.Context, _ string, port int) (int, error) {
	if port <= 0 {
		return 0, fmt.Errorf("无效端口")
	}
	if port >= 30000 && port <= 32767 {
		return port, nil
	}
	return port, nil
}

func (m *Memory) SyncPullSecrets(_ context.Context, ns string, regs []models.DockerRegistryCred) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.pull == nil {
		m.pull = map[string][]models.DockerRegistryCred{}
	}
	cp := append([]models.DockerRegistryCred(nil), regs...)
	m.pull[ns] = cp
	if m.ns[ns] == nil {
		m.ns[ns] = map[string]Resource{}
	}
	if len(regs) > 0 {
		m.ns[ns]["secret/"+PullSecretName] = Resource{Kind: "Secret", Name: PullSecretName, Namespace: ns}
	}
	return nil
}

func (m *Memory) PullSecrets(ns string) []models.DockerRegistryCred {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]models.DockerRegistryCred(nil), m.pull[ns]...)
}

func (m *Memory) Quota(ns string) map[string]string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]string{}
	for k, v := range m.quotas[ns] {
		out[k] = v
	}
	return out
}

// Unavailable is used when HA_KUBECONFIG is unset and memory backend is not allowed.
type Unavailable struct{}

func (Unavailable) Available(context.Context) error { return ErrUnavailable }

func (Unavailable) Provision(context.Context, models.Workspace, string) (string, string, error) {
	return "", "", ErrUnavailable
}

func (Unavailable) Apply(context.Context, string, string) ([]Resource, error) {
	return nil, ErrUnavailable
}

func (Unavailable) Resources(context.Context, string) ([]Resource, error) {
	return nil, ErrUnavailable
}

func (Unavailable) Delete(context.Context, string, string, string) error { return ErrUnavailable }

func (Unavailable) DestroyNS(context.Context, string) error { return ErrUnavailable }

func (Unavailable) Kubeconfig(string) (string, error) { return "", ErrUnavailable }

func (Unavailable) ServiceNodePort(context.Context, string, int) (int, error) {
	return 0, ErrUnavailable
}

func (Unavailable) SyncPullSecrets(context.Context, string, []models.DockerRegistryCred) error {
	return ErrUnavailable
}

// Kubectl talks to a real cluster when HA_KUBECONFIG is set.
type Kubectl struct {
	KubeconfigPath string
	memory         *Memory
}

func NewFromEnv() Cluster {
	path := strings.TrimSpace(os.Getenv("HA_KUBECONFIG"))
	if path != "" {
		return &Kubectl{KubeconfigPath: path, memory: NewMemory()}
	}
	if memoryAllowed() {
		return NewMemory()
	}
	return Unavailable{}
}

func (k *Kubectl) run(ctx context.Context, stdin []byte, args ...string) error {
	_, err := k.runOut(ctx, stdin, args...)
	return err
}

func (k *Kubectl) runOut(ctx context.Context, stdin []byte, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "kubectl", append([]string{"--kubeconfig", k.KubeconfigPath}, args...)...)
	if len(stdin) > 0 {
		cmd.Stdin = bytes.NewReader(stdin)
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return out, fmt.Errorf("kubectl: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return out, nil
}

func (k *Kubectl) Available(ctx context.Context) error {
	if strings.TrimSpace(k.KubeconfigPath) == "" {
		return ErrUnavailable
	}
	if _, err := os.Stat(k.KubeconfigPath); err != nil {
		return fmt.Errorf("%w: kubeconfig 不可读", ErrUnavailable)
	}
	if err := k.run(ctx, nil, "get", "--raw=/readyz"); err != nil {
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	return nil
}

func (k *Kubectl) Provision(ctx context.Context, w models.Workspace, slug string) (string, string, error) {
	if err := k.Available(ctx); err != nil {
		return "", "", err
	}
	ns, _, err := k.memory.Provision(ctx, w, slug)
	if err != nil {
		return "", "", err
	}
	if err := k.run(ctx, nil, "create", "namespace", ns, "--dry-run=client", "-o", "name"); err != nil {
		return "", "", err
	}
	_ = k.run(ctx, nil, "create", "namespace", ns)
	q := QuotaFromPlan(w.CPUMilli, w.MemBytes)
	quotaYAML := fmt.Sprintf("apiVersion: v1\nkind: ResourceQuota\nmetadata:\n  name: project-quota\n  namespace: %s\nspec:\n  hard:\n    requests.cpu: %q\n    requests.memory: %q\n    pods: %q\n    services: %q\n",
		ns, q["requests.cpu"], q["requests.memory"], q["pods"], q["services"])
	if err := k.run(ctx, []byte(quotaYAML), "apply", "-f", "-"); err != nil {
		return "", "", err
	}
	kc, err := k.Kubeconfig(ns)
	if err != nil {
		return "", "", err
	}
	k.memory.mu.Lock()
	k.memory.kube[ns] = kc
	k.memory.mu.Unlock()
	return ns, kc, nil
}

func (k *Kubectl) Apply(ctx context.Context, ns, yamlText string) ([]Resource, error) {
	objs, err := SplitAndSanitize(yamlText, ns)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	for i, o := range objs {
		if i > 0 {
			buf.WriteString("\n---\n")
		}
		buf.Write(o.Raw)
	}
	if err := k.run(ctx, buf.Bytes(), "apply", "-n", ns, "-f", "-"); err != nil {
		return nil, err
	}
	return k.memory.Apply(ctx, ns, yamlText)
}

func (k *Kubectl) Resources(ctx context.Context, ns string) ([]Resource, error) {
	out, err := k.runOut(ctx, nil, "get", "deploy,svc,cm,secret,pvc,ing,po", "-n", ns, "-o", "json")
	if err != nil {
		return k.memory.Resources(ctx, ns)
	}
	var list struct {
		Items []struct {
			Kind     string `json:"kind"`
			Metadata struct {
				Name      string `json:"name"`
				Namespace string `json:"namespace"`
			} `json:"metadata"`
		} `json:"items"`
	}
	if err := json.Unmarshal(out, &list); err != nil {
		return k.memory.Resources(ctx, ns)
	}
	res := make([]Resource, 0, len(list.Items))
	for _, it := range list.Items {
		if it.Kind == "" || it.Metadata.Name == "" {
			continue
		}
		nsName := it.Metadata.Namespace
		if nsName == "" {
			nsName = ns
		}
		res = append(res, Resource{Kind: it.Kind, Name: it.Metadata.Name, Namespace: nsName})
	}
	return res, nil
}

func (k *Kubectl) Delete(ctx context.Context, ns, kind, name string) error {
	_ = k.run(ctx, nil, "delete", kind, name, "-n", ns, "--ignore-not-found")
	return k.memory.Delete(ctx, ns, kind, name)
}

func (k *Kubectl) DestroyNS(ctx context.Context, ns string) error {
	_ = k.run(ctx, nil, "delete", "namespace", ns, "--ignore-not-found")
	return k.memory.DestroyNS(ctx, ns)
}

func (k *Kubectl) Kubeconfig(ns string) (string, error) {
	raw, err := os.ReadFile(k.KubeconfigPath)
	if err != nil {
		return "", fmt.Errorf("%w: 读取 kubeconfig: %v", ErrUnavailable, err)
	}
	server := strings.TrimSpace(os.Getenv("HA_K8S_SERVER"))
	return rewriteKubeconfig(raw, ns, server), nil
}

func (k *Kubectl) SyncPullSecrets(ctx context.Context, ns string, regs []models.DockerRegistryCred) error {
	if err := k.memory.SyncPullSecrets(ctx, ns, regs); err != nil {
		return err
	}
	if len(regs) == 0 {
		return nil
	}
	secretYAML, err := pullSecretYAML(ns, regs)
	if err != nil {
		return err
	}
	if err := k.run(ctx, []byte(secretYAML), "apply", "-f", "-"); err != nil {
		return err
	}
	return k.run(ctx, []byte(defaultServiceAccountYAML(ns)), "apply", "-f", "-")
}

func (k *Kubectl) ServiceNodePort(ctx context.Context, ns string, port int) (int, error) {
	out, err := k.runOut(ctx, nil, "get", "svc", "-n", ns, "-o", "json")
	if err != nil {
		return 0, err
	}
	var list struct {
		Items []struct {
			Spec struct {
				Type  string `json:"type"`
				Ports []struct {
					Port       int             `json:"port"`
					TargetPort json.RawMessage `json:"targetPort"`
					NodePort   int             `json:"nodePort"`
				} `json:"ports"`
			} `json:"spec"`
		} `json:"items"`
	}
	if err := json.Unmarshal(out, &list); err != nil {
		return 0, err
	}
	for _, it := range list.Items {
		typ := strings.ToLower(it.Spec.Type)
		if typ != "" && typ != "nodeport" && typ != "loadbalancer" {
			continue
		}
		for _, p := range it.Spec.Ports {
			if p.NodePort <= 0 {
				continue
			}
			if p.Port == port {
				return p.NodePort, nil
			}
			if tp := jsonNumberOrString(p.TargetPort); tp == strconv.Itoa(port) {
				return p.NodePort, nil
			}
		}
	}
	return 0, fmt.Errorf("namespace %s 没有端口 %d 的 NodePort Service", ns, port)
}

func jsonNumberOrString(raw json.RawMessage) string {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return ""
	}
	if raw[0] == '"' {
		var s string
		if json.Unmarshal(raw, &s) == nil {
			return s
		}
		return ""
	}
	var n int
	if json.Unmarshal(raw, &n) == nil {
		return strconv.Itoa(n)
	}
	return strings.Trim(string(raw), `"`)
}

func rewriteKubeconfig(raw []byte, ns, server string) string {
	var root map[string]any
	if err := yaml.Unmarshal(raw, &root); err != nil {
		return string(raw)
	}
	if server != "" {
		if clusters, ok := root["clusters"].([]any); ok {
			for _, c := range clusters {
				m, _ := c.(map[string]any)
				cl, _ := m["cluster"].(map[string]any)
				if cl != nil {
					cl["server"] = server
				}
			}
		}
	}
	if ns != "" {
		if contexts, ok := root["contexts"].([]any); ok {
			for _, c := range contexts {
				m, _ := c.(map[string]any)
				ctx, _ := m["context"].(map[string]any)
				if ctx != nil {
					ctx["namespace"] = ns
				}
			}
		}
	}
	out, err := yaml.Marshal(root)
	if err != nil {
		return string(raw)
	}
	return string(out)
}
