package service

import (
	"errors"
	"strings"
	"testing"

	hak8s "ha-cluster/internal/k8s"
	"ha-cluster/internal/models"
	"ha-cluster/internal/store"
)

func TestCreateK8sWorkspaceApplyAndViewerDeny(t *testing.T) {
	app, owner := setupApp(t)
	ctx := t.Context()
	p, err := app.CreateProject(ctx, owner.ID, "k8s-demo", "k8s-demo", "test purpose")
	if err != nil {
		t.Fatal(err)
	}
	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "ns-dev", Plan: "nano", Arch: models.ArchAMD64,
		Runtime: models.RuntimeK8s, Actor: *owner,
	})
	if err != nil {
		t.Fatal(err)
	}
	if ws.Status != models.WSRunning || !models.IsK8sRuntime(ws.Runtime) || ws.RuntimeRef == "" {
		t.Fatalf("%+v", ws)
	}

	deploy := `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: evil
spec:
  replicas: 1
`
	applied, err := app.ApplyK8sYAML(ctx, *owner, ws.ID, deploy)
	if err != nil || len(applied) != 1 {
		t.Fatal(err, applied)
	}
	if applied[0]["namespace"] != ws.RuntimeRef || applied[0]["name"] != "web" {
		t.Fatalf("%v", applied)
	}
	list, err := app.ListK8sResources(ctx, *owner, ws.ID)
	if err != nil || len(list) != 1 {
		t.Fatal(err, list)
	}
	st, err := app.K8sStatus(ctx, *owner, ws.ID)
	if err != nil || st == nil || st.Namespace != ws.RuntimeRef {
		t.Fatal(err, st)
	}
	if st.Quota == nil || st.Quota.Name != "project-quota" {
		t.Fatalf("quota %+v", st.Quota)
	}
	kc, err := app.WorkspaceKubeconfig(ctx, *owner, ws.ID)
	if err != nil || !strings.Contains(kc, ws.RuntimeRef) {
		t.Fatal(err, kc)
	}

	viewer, err := app.Register(ctx, "k8s-viewer", "k8s-viewer@example.com", "password1")
	if err != nil {
		t.Fatal(err)
	}
	if err := app.Store.AddMembership(ctx, models.Membership{
		ProjectID: p.ID, UserID: viewer.ID, Role: models.RoleViewer,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := app.ApplyK8sYAML(ctx, *viewer, ws.ID, deploy); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("viewer apply: %v", err)
	}
	if _, err := app.ListK8sResources(ctx, *viewer, ws.ID); err != nil {
		t.Fatal(err)
	}

	if _, err := app.ApplyK8sYAML(ctx, *owner, ws.ID, `
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: god
`); err == nil {
		t.Fatal("clusterrole should be rejected")
	}

	if err := app.RequestDestroyWorkspace(ctx, *owner, ws.ID); err != nil {
		t.Fatal(err)
	}
	got, _ := app.Store.GetWorkspace(ctx, ws.ID)
	if got.Status != models.WSDestroyed {
		t.Fatalf("status=%s", got.Status)
	}
	left, err := app.K8s.Resources(ctx, ws.RuntimeRef)
	if err != nil {
		t.Fatal(err)
	}
	if len(left) != 0 {
		t.Fatalf("ns leftover: %v", left)
	}
}

func TestDeveloperK8sRequestNeedsApproval(t *testing.T) {
	app, owner := setupApp(t)
	ctx := t.Context()
	p, err := app.CreateProject(ctx, owner.ID, "k8s-appr", "k8s-appr", "test purpose")
	if err != nil {
		t.Fatal(err)
	}
	dev, err := app.Register(ctx, "k8s-dev", "k8s-dev@example.com", "password1")
	if err != nil {
		t.Fatal(err)
	}
	if err := app.Store.AddMembership(ctx, models.Membership{
		ProjectID: p.ID, UserID: dev.ID, Role: models.RoleDeveloper, SSHAccess: models.SSHAccessGranted,
	}); err != nil {
		t.Fatal(err)
	}

	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "k8s-need-ok", Plan: "nano", Arch: models.ArchAMD64,
		Runtime: models.RuntimeK8s, Actor: *dev,
	})
	if err != nil {
		t.Fatal(err)
	}
	if ws.Status != models.WSRequested || !models.IsK8sRuntime(ws.Runtime) {
		t.Fatalf("developer k8s must wait for approval, got %+v", ws)
	}
	nodes, _ := app.Store.ListNodes(ctx)
	if nodes[0].UsedMem != 0 {
		t.Fatal("k8s request must not occupy capacity")
	}
	if _, err := app.ApproveWorkspace(ctx, *dev, ws.ID); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("developer cannot approve k8s, got %v", err)
	}

	got, err := app.ApproveWorkspace(ctx, *owner, ws.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != models.WSRunning || !models.IsK8sRuntime(got.Runtime) || got.RuntimeRef == "" {
		t.Fatalf("%+v", got)
	}
}

func TestCreateK8sWorkspaceNeedsTaggedNode(t *testing.T) {
	app, owner := setupApp(t)
	ctx := t.Context()
	nodes, _ := app.Store.ListNodes(ctx)
	for _, n := range nodes {
		_ = app.Store.UpdateNodeMeta(ctx, n.ID, n.MachineType, n.Remark, []string{"gpu"})
	}
	p, err := app.CreateProject(ctx, owner.ID, "no-k8s", "no-k8s", "test purpose")
	if err != nil {
		t.Fatal(err)
	}
	_, err = app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "fail", Plan: "nano", Arch: models.ArchAMD64,
		Runtime: models.RuntimeK8s, Actor: *owner,
	})
	if !errors.Is(err, store.ErrNoCapacity) {
		t.Fatalf("want no capacity, got %v", err)
	}
}

func TestInvalidRuntimeRejected(t *testing.T) {
	app, owner := setupApp(t)
	ctx := t.Context()
	p, err := app.CreateProject(ctx, owner.ID, "bad-rt", "bad-rt", "test purpose")
	if err != nil {
		t.Fatal(err)
	}
	_, err = app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "x", Plan: "nano", Arch: models.ArchAMD64,
		Runtime: "qemu", Actor: *owner,
	})
	if !errors.Is(err, store.ErrInvalidInput) {
		t.Fatalf("%v", err)
	}
}

func TestApplyK8sWhenFabricDegraded(t *testing.T) {
	app, owner := setupApp(t)
	ctx := t.Context()
	p, err := app.CreateProject(ctx, owner.ID, "k8s-deg", "k8s-deg", "test purpose")
	if err != nil {
		t.Fatal(err)
	}
	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "ns-deg", Plan: "nano", Arch: models.ArchAMD64,
		Runtime: models.RuntimeK8s, Actor: *owner,
	})
	if err != nil {
		t.Fatal(err)
	}
	ws.Status = models.WSDegraded
	if err := app.Store.UpdateWorkspace(ctx, ws); err != nil {
		t.Fatal(err)
	}
	applied, err := app.ApplyK8sYAML(ctx, *owner, ws.ID, `
apiVersion: v1
kind: ConfigMap
metadata:
  name: snacks-cfg
data:
  k: v
`)
	if err != nil || len(applied) != 1 {
		t.Fatal(err, applied)
	}
}

func TestCreateK8sRejectedWhenClusterUnavailable(t *testing.T) {
	app, owner := setupApp(t)
	app.K8s = hak8s.Unavailable{}
	ctx := t.Context()
	p, err := app.CreateProject(ctx, owner.ID, "no-cluster", "no-cluster", "test purpose")
	if err != nil {
		t.Fatal(err)
	}
	_, err = app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "fail", Plan: "nano", Arch: models.ArchAMD64,
		Runtime: models.RuntimeK8s, Actor: *owner,
	})
	if !errors.Is(err, hak8s.ErrUnavailable) {
		t.Fatalf("want K8S_UNAVAILABLE, got %v", err)
	}
}

func TestCreateK8sInjectsAutoRegistryPullSecret(t *testing.T) {
	app, owner := setupApp(t)
	ctx := t.Context()
	if _, err := app.CreateDockerRegistry(ctx, *owner, models.DockerRegistry{
		Name: "cnb", Server: "docker.cnb.cool", Username: "bot", AutoInject: true,
	}, "s3cret-token"); err != nil {
		t.Fatal(err)
	}
	p, err := app.CreateProject(ctx, owner.ID, "k8s-pull", "k8s-pull", "test purpose")
	if err != nil {
		t.Fatal(err)
	}
	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "ns-pull", Plan: "nano", Arch: models.ArchAMD64,
		Runtime: models.RuntimeK8s, Actor: *owner,
	})
	if err != nil {
		t.Fatal(err)
	}
	mem, ok := app.K8s.(*hak8s.Memory)
	if !ok {
		t.Fatalf("want memory cluster, got %T", app.K8s)
	}
	got := mem.PullSecrets(ws.RuntimeRef)
	if len(got) != 1 || got[0].Server != "docker.cnb.cool" || got[0].Username != "bot" || got[0].Password != "s3cret-token" {
		t.Fatalf("%+v", got)
	}
	applied, err := app.ApplyK8sYAML(ctx, *owner, ws.ID, `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: snacks
spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: snacks
        image: docker.cnb.cool/qzsyzn/docker:snacks
        resources:
          requests:
            cpu: 50m
            memory: 64Mi
`)
	if err != nil || len(applied) != 1 {
		t.Fatal(err, applied)
	}
}

func TestApplyK8sYAMLRejectsMissingRequests(t *testing.T) {
	app, owner := setupApp(t)
	ctx := t.Context()
	p, err := app.CreateProject(ctx, owner.ID, "k8s-quota", "k8s-quota", "test purpose")
	if err != nil {
		t.Fatal(err)
	}
	ws, err := app.CreateWorkspace(ctx, CreateWorkspaceInput{
		ProjectID: p.ID, Name: "ns-quota", Plan: "nano", Arch: models.ArchAMD64,
		Runtime: models.RuntimeK8s, Actor: *owner,
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = app.ApplyK8sYAML(ctx, *owner, ws.ID, `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: snacks
spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: snacks
        image: docker.cnb.cool/qzsyzn/docker:snacks
`)
	if !errors.Is(err, hak8s.ErrQuotaBlocked) {
		t.Fatalf("want quota blocked, got %v", err)
	}
	if !strings.Contains(err.Error(), "resources.requests") || !strings.Contains(err.Error(), "project-quota") {
		t.Fatal(err)
	}
}
