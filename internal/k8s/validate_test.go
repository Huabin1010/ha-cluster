package k8s

import (
	"strings"
	"testing"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
)

func TestSplitAndSanitizeRewritesNamespace(t *testing.T) {
	objs, err := SplitAndSanitize(`
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: evil
spec:
  replicas: 1
`, "proj-demo-abc")
	if err != nil {
		t.Fatal(err)
	}
	if len(objs) != 1 || objs[0].Namespace != "proj-demo-abc" || objs[0].Name != "web" {
		t.Fatalf("%+v", objs)
	}
	if !strings.Contains(string(objs[0].Raw), "namespace: proj-demo-abc") {
		t.Fatalf("raw=%s", objs[0].Raw)
	}
}

func TestSplitAndSanitizeRejectsClusterRole(t *testing.T) {
	_, err := SplitAndSanitize(`
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: god
`, "ns")
	if err == nil {
		t.Fatal("expected reject")
	}
}

func TestQuotaFromPlan(t *testing.T) {
	q := QuotaFromPlan(2000, 2<<30)
	if q["requests.cpu"] != "2000m" {
		t.Fatalf("%v", q)
	}
}

func TestNamespaceName(t *testing.T) {
	id := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	got := NamespaceName("Office", id)
	if got != "proj-office-aaaaaaaa" {
		t.Fatalf("%s", got)
	}
}

func TestMemoryApplyRoundTrip(t *testing.T) {
	m := NewMemory()
	w := models.Workspace{ID: uuid.New(), CPUMilli: 500, MemBytes: 256 << 20}
	ns, kc, err := m.Provision(t.Context(), w, "demo")
	if err != nil || ns == "" || kc == "" {
		t.Fatal(err, ns, kc)
	}
	res, err := m.Apply(t.Context(), ns, `
apiVersion: v1
kind: ConfigMap
metadata:
  name: app
data:
  k: v
`)
	if err != nil || len(res) != 1 {
		t.Fatal(err, res)
	}
	list, err := m.Resources(t.Context(), ns)
	if err != nil || len(list) != 1 {
		t.Fatal(err, list)
	}
	if err := m.Delete(t.Context(), ns, "ConfigMap", "app"); err != nil {
		t.Fatal(err)
	}
	if err := m.DestroyNS(t.Context(), ns); err != nil {
		t.Fatal(err)
	}
}
