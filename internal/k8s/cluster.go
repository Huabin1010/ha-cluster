package k8s

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
)

type Resource struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
}

type Cluster interface {
	Provision(ctx context.Context, w models.Workspace, slug string) (ns, kubeconfig string, err error)
	Apply(ctx context.Context, ns, yamlText string) ([]Resource, error)
	Resources(ctx context.Context, ns string) ([]Resource, error)
	Delete(ctx context.Context, ns, kind, name string) error
	DestroyNS(ctx context.Context, ns string) error
	Kubeconfig(ns string) (string, error)
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

type Memory struct {
	mu     sync.Mutex
	ns     map[string]map[string]Resource // ns -> kind/name
	kube   map[string]string
	quotas map[string]map[string]string
}

func NewMemory() *Memory {
	return &Memory{
		ns:     map[string]map[string]Resource{},
		kube:   map[string]string{},
		quotas: map[string]map[string]string{},
	}
}

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
		return nil, fmt.Errorf("namespace 不存在")
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

func (m *Memory) Quota(ns string) map[string]string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[string]string{}
	for k, v := range m.quotas[ns] {
		out[k] = v
	}
	return out
}

// Kubectl talks to a real cluster when HA_KUBECONFIG is set.
type Kubectl struct {
	KubeconfigPath string
	memory         *Memory
}

func NewFromEnv() Cluster {
	path := strings.TrimSpace(os.Getenv("HA_KUBECONFIG"))
	if path == "" {
		return NewMemory()
	}
	return &Kubectl{KubeconfigPath: path, memory: NewMemory()}
}

func (k *Kubectl) run(ctx context.Context, stdin []byte, args ...string) error {
	cmd := exec.CommandContext(ctx, "kubectl", append([]string{"--kubeconfig", k.KubeconfigPath}, args...)...)
	if len(stdin) > 0 {
		cmd.Stdin = bytes.NewReader(stdin)
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("kubectl: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func (k *Kubectl) Provision(ctx context.Context, w models.Workspace, slug string) (string, string, error) {
	ns, kc, err := k.memory.Provision(ctx, w, slug)
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
	return k.memory.Resources(ctx, ns)
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
	return k.memory.Kubeconfig(ns)
}
