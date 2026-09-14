package k8s

import (
	"strings"
	"testing"

	"ha-cluster/internal/models"
)

const liveListJSON = `{
  "kind": "List",
  "items": [
    {
      "kind": "Deployment",
      "metadata": {
        "name": "goals",
        "namespace": "proj-goals-abc",
        "generation": 2,
        "labels": {"app": "goals", "release": "v2"}
      },
      "spec": {
        "replicas": 1,
        "selector": {"matchLabels": {"app": "goals"}},
        "strategy": {"type": "RollingUpdate", "rollingUpdate": {"maxUnavailable": 0, "maxSurge": 1}},
        "template": {
          "metadata": {"labels": {"app": "goals", "release": "v2"}},
          "spec": {
            "containers": [{
              "name": "app",
              "image": "docker.cnb.cool/qzsyzn/docker:goals-v2"
            }]
          }
        }
      },
      "status": {
        "replicas": 1,
        "readyReplicas": 0,
        "updatedReplicas": 0,
        "availableReplicas": 0,
        "unavailableReplicas": 1,
        "observedGeneration": 2
      }
    },
    {
      "kind": "ReplicaSet",
      "metadata": {
        "name": "goals-new",
        "namespace": "proj-goals-abc",
        "labels": {"app": "goals", "pod-template-hash": "new", "release": "v2"},
        "annotations": {"deployment.kubernetes.io/revision": "2"},
        "ownerReferences": [{"kind": "Deployment", "name": "goals"}]
      },
      "spec": {"replicas": 1, "template": {"spec": {"containers": [{"image": "docker.cnb.cool/qzsyzn/docker:goals-v2"}]}}},
      "status": {"replicas": 0, "readyReplicas": 0}
    },
    {
      "kind": "ReplicaSet",
      "metadata": {
        "name": "goals-old",
        "namespace": "proj-goals-abc",
        "labels": {"app": "goals", "pod-template-hash": "old", "release": "v1"},
        "annotations": {"deployment.kubernetes.io/revision": "1"},
        "ownerReferences": [{"kind": "Deployment", "name": "goals"}]
      },
      "spec": {"replicas": 1, "template": {"spec": {"containers": [{"image": "docker.cnb.cool/qzsyzn/docker:goals-v1"}]}}},
      "status": {"replicas": 1, "readyReplicas": 1}
    },
    {
      "kind": "Pod",
      "metadata": {
        "name": "goals-old-abc",
        "namespace": "proj-goals-abc",
        "labels": {"app": "goals", "release": "v1", "pod-template-hash": "old"},
        "creationTimestamp": "2026-09-14T04:00:00Z",
        "ownerReferences": [{"kind": "ReplicaSet", "name": "goals-old"}]
      },
      "spec": {
        "nodeName": "ha-test-01",
        "containers": [{"name": "app", "image": "docker.cnb.cool/qzsyzn/docker:goals-v1", "resources": {"requests": {"cpu": "50m", "memory": "64Mi"}}}]
      },
      "status": {
        "phase": "Running",
        "conditions": [{"type": "Ready", "status": "True"}],
        "containerStatuses": [{"name": "app", "ready": true, "restartCount": 0}]
      }
    },
    {
      "kind": "Service",
      "metadata": {"name": "goals", "namespace": "proj-goals-abc", "labels": {"app": "goals"}},
      "spec": {"type": "ClusterIP", "clusterIP": "10.43.0.10", "ports": [{"name": "http", "port": 80, "targetPort": 8080}]}
    },
    {
      "kind": "ResourceQuota",
      "metadata": {"name": "project-quota", "namespace": "proj-goals-abc"},
      "spec": {"hard": {"requests.cpu": "500m", "requests.memory": "268435456", "pods": "20"}},
      "status": {"hard": {"requests.cpu": "500m", "requests.memory": "268435456", "pods": "20"}, "used": {"requests.cpu": "50m", "requests.memory": "67108864", "pods": "1"}}
    }
  ]
}`

const liveEventsJSON = `{
  "kind": "List",
  "items": [
    {
      "type": "Warning",
      "reason": "FailedCreate",
      "message": "Error creating: pods \"goals-new-xyz\" is forbidden: exceeded quota: project-quota, requested: requests.cpu=100m, used: requests.cpu=50m, limited: requests.cpu=500m",
      "involvedObject": {"kind": "ReplicaSet", "name": "goals-new"},
      "count": 12,
      "lastTimestamp": "2026-09-14T05:01:00Z"
    }
  ]
}`

func TestParseLiveListShowsRolloutAndQuota(t *testing.T) {
	st := parseObjectList("proj-goals-abc", []byte(liveListJSON))
	st.Events = parseEventList([]byte(liveEventsJSON))
	finalizeStatus(&st)

	if st.Summary.Deployments != 1 || st.Summary.ReplicaSets != 2 || st.Summary.Pods != 1 {
		t.Fatalf("summary %+v", st.Summary)
	}
	if st.Summary.RunningPods != 1 {
		t.Fatalf("running pods %d", st.Summary.RunningPods)
	}
	if len(st.Deployments) != 1 {
		t.Fatalf("deployments %d", len(st.Deployments))
	}
	d := st.Deployments[0]
	if d.Name != "goals" || d.Strategy != "RollingUpdate" || d.MaxUnavailable != "0" || d.MaxSurge != "1" {
		t.Fatalf("strategy %+v", d)
	}
	if d.Replicas != 1 || d.ReadyReplicas != 0 || !d.Rolling || !d.MissingRequests {
		t.Fatalf("rollout %+v", d)
	}
	if d.Labels["release"] != "v2" {
		t.Fatalf("labels %v", d.Labels)
	}
	if st.Quota == nil || st.Quota.Used["requests.cpu"] != "50m" {
		t.Fatalf("quota %+v", st.Quota)
	}
	if st.Pods[0].Labels["release"] != "v1" || !st.Pods[0].Ready {
		t.Fatalf("pod %+v", st.Pods[0])
	}
	if len(st.ReplicaSets) != 2 || st.ReplicaSets[0].Name != "goals-new" {
		t.Fatalf("rs %+v", st.ReplicaSets)
	}
	joined := strings.Join(st.Warnings, "\n")
	if !strings.Contains(joined, "resources.requests") || !strings.Contains(joined, "滚动更新未完成") {
		t.Fatalf("warnings %v", st.Warnings)
	}
	if !strings.Contains(joined, "project-quota") {
		t.Fatalf("quota warning missing: %v", st.Warnings)
	}
}

func TestMemoryStatusWarnsMissingRequests(t *testing.T) {
	m := NewMemory()
	ws := models.Workspace{CPUMilli: 500, MemBytes: 256 << 20}
	ns, _, err := m.Provision(t.Context(), ws, "goals")
	if err != nil {
		t.Fatal(err)
	}
	yamlText := `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: goals
  labels:
    release: v2
spec:
  replicas: 2
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels:
      app: goals
  template:
    metadata:
      labels:
        app: goals
        release: v2
    spec:
      containers:
      - name: app
        image: docker.cnb.cool/qzsyzn/docker:goals
`
	if _, err := m.Apply(t.Context(), ns, yamlText); err != nil {
		t.Fatal(err)
	}
	st, err := m.Status(t.Context(), ns)
	if err != nil {
		t.Fatal(err)
	}
	if len(st.Deployments) != 1 || st.Deployments[0].Replicas != 2 {
		t.Fatalf("%+v", st.Deployments)
	}
	if st.Deployments[0].Strategy != "RollingUpdate" || st.Deployments[0].MaxUnavailable != "0" {
		t.Fatalf("strategy %+v", st.Deployments[0])
	}
	if !st.Deployments[0].MissingRequests {
		t.Fatal("want missing_requests")
	}
	if st.Quota == nil || st.Quota.Hard["pods"] != "20" {
		t.Fatalf("quota %+v", st.Quota)
	}
	joined := strings.Join(st.Warnings, "\n")
	if !strings.Contains(joined, "resources.requests") {
		t.Fatalf("warnings %v", st.Warnings)
	}
	res, err := m.Resources(t.Context(), ns)
	if err != nil || len(res) != 1 || res[0].Labels["release"] != "v2" || res[0].Ready != "0/2" {
		t.Fatalf("resources %+v %v", res, err)
	}
}

func TestMemoryStatusNoWarningWhenRequestsPresent(t *testing.T) {
	m := NewMemory()
	ws := models.Workspace{CPUMilli: 500, MemBytes: 256 << 20}
	ns, _, err := m.Provision(t.Context(), ws, "ok")
	if err != nil {
		t.Fatal(err)
	}
	_, err = m.Apply(t.Context(), ns, `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: web
        image: nginx:stable
        resources:
          requests:
            cpu: 50m
            memory: 64Mi
`)
	if err != nil {
		t.Fatal(err)
	}
	st, err := m.Status(t.Context(), ns)
	if err != nil {
		t.Fatal(err)
	}
	if st.Deployments[0].MissingRequests {
		t.Fatal("did not expect missing_requests")
	}
	for _, w := range st.Warnings {
		if strings.Contains(w, "resources.requests") {
			t.Fatalf("unexpected warning %s", w)
		}
	}
}

func TestStaleReplicaSetEventsGoToHistory(t *testing.T) {
	st := NamespaceStatus{
		Namespace: "ns",
		Deployments: []DeploymentStatus{{
			Name: "goals", Replicas: 2, ReadyReplicas: 2, UpdatedReplicas: 2, AvailableReplicas: 2,
		}},
		ReplicaSets: []ReplicaSetStatus{
			{Name: "goals-new", Desired: 2, Current: 2, Ready: 2, Generation: 4, Labels: map[string]string{"release": "v4"}},
			{Name: "goals-old", Desired: 0, Current: 0, Ready: 0, Generation: 1, Labels: map[string]string{"release": "v1"}},
		},
		Pods: []PodStatus{{Name: "goals-new-abc", Phase: "Running", Ready: true}},
		Events: []EventStatus{{
			Type: "Warning", Reason: "FailedCreate", ObjectKind: "ReplicaSet", ObjectName: "goals-old",
			Message: "pods is forbidden: failed quota: project-quota: must specify requests.cpu for: goals",
		}},
	}
	finalizeStatus(&st)
	if len(st.Warnings) != 0 {
		t.Fatalf("current warnings should be empty, got %v", st.Warnings)
	}
	if st.Summary.Warnings != 0 || st.Summary.ReadyDeployments != 1 {
		t.Fatalf("summary %+v", st.Summary)
	}
	if !st.ReplicaSets[0].Active || st.ReplicaSets[1].Active {
		t.Fatalf("active flags %+v", st.ReplicaSets)
	}
	if len(st.History) == 0 || !strings.Contains(st.History[0], "goals-old") {
		t.Fatalf("history %v", st.History)
	}
	if !st.Events[0].Stale {
		t.Fatal("event should be marked stale")
	}
}
