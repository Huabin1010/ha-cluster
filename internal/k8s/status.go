package k8s

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type ReplicaCounts struct {
	Desired     int `json:"desired"`
	Ready       int `json:"ready"`
	Updated     int `json:"updated,omitempty"`
	Available   int `json:"available,omitempty"`
	Unavailable int `json:"unavailable,omitempty"`
	Current     int `json:"current,omitempty"`
}

type Condition struct {
	Type    string `json:"type"`
	Status  string `json:"status"`
	Reason  string `json:"reason,omitempty"`
	Message string `json:"message,omitempty"`
}

type QuotaStatus struct {
	Name string            `json:"name"`
	Hard map[string]string `json:"hard,omitempty"`
	Used map[string]string `json:"used,omitempty"`
}

type DeploymentStatus struct {
	Name                string            `json:"name"`
	Namespace           string            `json:"namespace"`
	Labels              map[string]string `json:"labels,omitempty"`
	Selector            map[string]string `json:"selector,omitempty"`
	Replicas            int               `json:"replicas"`
	ReadyReplicas       int               `json:"ready_replicas"`
	UpdatedReplicas     int               `json:"updated_replicas"`
	AvailableReplicas   int               `json:"available_replicas"`
	UnavailableReplicas int               `json:"unavailable_replicas"`
	Generation          int64             `json:"generation"`
	ObservedGeneration  int64             `json:"observed_generation"`
	Strategy            string            `json:"strategy,omitempty"`
	MaxUnavailable      string            `json:"max_unavailable,omitempty"`
	MaxSurge            string            `json:"max_surge,omitempty"`
	Images              []string          `json:"images,omitempty"`
	Conditions          []Condition       `json:"conditions,omitempty"`
	Rolling             bool              `json:"rolling"`
	MissingRequests     bool              `json:"missing_requests,omitempty"`
}

type ReplicaSetStatus struct {
	Name       string            `json:"name"`
	Namespace  string            `json:"namespace"`
	Owner      string            `json:"owner,omitempty"`
	Labels     map[string]string `json:"labels,omitempty"`
	Desired    int               `json:"desired"`
	Current    int               `json:"current"`
	Ready      int               `json:"ready"`
	Generation int64             `json:"generation,omitempty"`
	Images     []string          `json:"images,omitempty"`
	Active     bool              `json:"active"`
}

type PodStatus struct {
	Name      string            `json:"name"`
	Namespace string            `json:"namespace"`
	Phase     string            `json:"phase"`
	Ready     bool              `json:"ready"`
	Restarts  int               `json:"restarts"`
	Labels    map[string]string `json:"labels,omitempty"`
	Reason    string            `json:"reason,omitempty"`
	Message   string            `json:"message,omitempty"`
	Node      string            `json:"node,omitempty"`
	OwnerKind string            `json:"owner_kind,omitempty"`
	OwnerName string            `json:"owner_name,omitempty"`
	Images    []string          `json:"images,omitempty"`
	CreatedAt string            `json:"created_at,omitempty"`
	Requests  map[string]string `json:"requests,omitempty"`
}

type ServiceStatus struct {
	Name      string            `json:"name"`
	Namespace string            `json:"namespace"`
	Type      string            `json:"type,omitempty"`
	ClusterIP string            `json:"cluster_ip,omitempty"`
	Ports     []string          `json:"ports,omitempty"`
	Labels    map[string]string `json:"labels,omitempty"`
}

type EventStatus struct {
	Type       string `json:"type"`
	Reason     string `json:"reason"`
	Message    string `json:"message"`
	ObjectKind string `json:"object_kind,omitempty"`
	ObjectName string `json:"object_name,omitempty"`
	Count      int    `json:"count,omitempty"`
	LastSeen   string `json:"last_seen,omitempty"`
	Stale      bool   `json:"stale,omitempty"`
}

type StatusSummary struct {
	Deployments      int `json:"deployments"`
	ReadyDeployments int `json:"ready_deployments"`
	ReplicaSets      int `json:"replica_sets"`
	Pods             int `json:"pods"`
	RunningPods      int `json:"running_pods"`
	PendingPods      int `json:"pending_pods"`
	FailedPods       int `json:"failed_pods"`
	Warnings         int `json:"warnings"`
}

// NamespaceStatus is the agent-facing snapshot of a k8s workspace.
// Agents should poll this instead of exec-ing kubectl on another machine.
type NamespaceStatus struct {
	Namespace   string             `json:"namespace"`
	Summary     StatusSummary      `json:"summary"`
	Quota       *QuotaStatus       `json:"quota,omitempty"`
	Deployments []DeploymentStatus `json:"deployments"`
	ReplicaSets []ReplicaSetStatus `json:"replica_sets"`
	Pods        []PodStatus        `json:"pods"`
	Services    []ServiceStatus    `json:"services"`
	Events      []EventStatus      `json:"events"`
	Warnings    []string           `json:"warnings"`
	History     []string           `json:"history"`
	Resources   []Resource         `json:"resources"`
}

func resourceFromObject(o Object) Resource {
	r := Resource{Kind: o.Kind, Name: o.Name, Namespace: o.Namespace}
	var root map[string]any
	if err := yaml.Unmarshal(o.Raw, &root); err != nil {
		return r
	}
	fillResourceFromUnstructured(&r, root)
	return r
}

func fillResourceFromUnstructured(r *Resource, item map[string]any) {
	if r.Kind == "" {
		r.Kind = asString(item["kind"])
	}
	meta := asMap(item["metadata"])
	if r.Name == "" {
		r.Name = asString(meta["name"])
	}
	if r.Namespace == "" {
		r.Namespace = asString(meta["namespace"])
	}
	r.Labels = stringMap(meta["labels"])
	r.CreatedAt = asString(meta["creationTimestamp"])
	if refs := asList(meta["ownerReferences"]); len(refs) > 0 {
		own := asMap(refs[0])
		r.OwnerKind = asString(own["kind"])
		r.OwnerName = asString(own["name"])
	}
	switch strings.ToLower(r.Kind) {
	case "deployment", "statefulset", "daemonset", "replicaset":
		fillWorkloadResource(r, item)
	case "pod":
		fillPodResource(r, item)
	case "service":
		r.Phase = asString(nested(item, "spec", "type"))
		if r.Phase == "" {
			r.Phase = "ClusterIP"
		}
	case "resourcequota":
		hard := stringMap(nested(item, "status", "hard"))
		if len(hard) == 0 {
			hard = stringMap(nested(item, "spec", "hard"))
		}
		used := stringMap(nested(item, "status", "used"))
		if cpu := hard["requests.cpu"]; cpu != "" {
			r.Ready = fmt.Sprintf("cpu %s/%s", nz(used["requests.cpu"], "0"), cpu)
		}
	}
}

func fillWorkloadResource(r *Resource, item map[string]any) {
	desired := asInt(nested(item, "spec", "replicas"))
	ready := asInt(nested(item, "status", "readyReplicas"))
	updated := asInt(nested(item, "status", "updatedReplicas"))
	available := asInt(nested(item, "status", "availableReplicas"))
	unavailable := asInt(nested(item, "status", "unavailableReplicas"))
	current := asInt(nested(item, "status", "replicas"))
	r.Replicas = &ReplicaCounts{
		Desired: desired, Ready: ready, Updated: updated,
		Available: available, Unavailable: unavailable, Current: current,
	}
	r.Ready = fmt.Sprintf("%d/%d", ready, desired)
	r.Strategy = asString(nested(item, "spec", "strategy", "type"))
	r.MaxUnavailable = asIntOrString(nested(item, "spec", "strategy", "rollingUpdate", "maxUnavailable"))
	r.MaxSurge = asIntOrString(nested(item, "spec", "strategy", "rollingUpdate", "maxSurge"))
	r.Selector = stringMap(nested(item, "spec", "selector", "matchLabels"))
	containers := asList(nested(item, "spec", "template", "spec", "containers"))
	r.Images = imagesFromContainers(containers)
	r.MissingRequests = containersMissingRequests(containers)
	if r.Strategy == "" && strings.EqualFold(r.Kind, "Deployment") {
		r.Strategy = "RollingUpdate"
	}
}

func fillPodResource(r *Resource, item map[string]any) {
	r.Phase = asString(nested(item, "status", "phase"))
	reason, message := podWait(item)
	r.Reason = reason
	r.Message = message
	r.Restarts = podRestarts(item)
	readyN, total := podReadyCount(item)
	r.Ready = fmt.Sprintf("%d/%d", readyN, total)
	r.Images = imagesFromContainers(asList(nested(item, "spec", "containers")))
	r.MissingRequests = containersMissingRequests(asList(nested(item, "spec", "containers")))
}

func parseObjectList(ns string, raw []byte) NamespaceStatus {
	st := NamespaceStatus{Namespace: ns}
	var list struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		return st
	}
	for _, item := range list.Items {
		kind := asString(item["kind"])
		if kind == "" {
			continue
		}
		var res Resource
		res.Kind = kind
		fillResourceFromUnstructured(&res, item)
		if res.Name == "" {
			continue
		}
		if res.Namespace == "" {
			res.Namespace = ns
		}
		st.Resources = append(st.Resources, res)
		switch strings.ToLower(kind) {
		case "deployment":
			st.Deployments = append(st.Deployments, deploymentFromItem(ns, item, res))
		case "replicaset":
			st.ReplicaSets = append(st.ReplicaSets, replicaSetFromItem(ns, item, res))
		case "pod":
			st.Pods = append(st.Pods, podFromItem(ns, item, res))
		case "service":
			st.Services = append(st.Services, serviceFromItem(ns, item, res))
		case "resourcequota":
			st.Quota = quotaFromItem(item)
		}
	}
	return st
}

func parseEventList(raw []byte) []EventStatus {
	var list struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil
	}
	out := make([]EventStatus, 0, len(list.Items))
	for _, item := range list.Items {
		involved := asMap(item["involvedObject"])
		if involved == nil {
			involved = asMap(item["regarding"])
		}
		last := asString(item["lastTimestamp"])
		if last == "" {
			last = asString(item["eventTime"])
		}
		if last == "" {
			last = asString(nested(item, "metadata", "creationTimestamp"))
		}
		count := asInt(item["count"])
		if count == 0 {
			count = asInt(nested(item, "series", "count"))
		}
		out = append(out, EventStatus{
			Type:       nz(asString(item["type"]), "Normal"),
			Reason:     asString(item["reason"]),
			Message:    asString(item["message"]),
			ObjectKind: asString(involved["kind"]),
			ObjectName: asString(involved["name"]),
			Count:      count,
			LastSeen:   last,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		return eventTime(out[i].LastSeen).After(eventTime(out[j].LastSeen))
	})
	if len(out) > 40 {
		out = out[:40]
	}
	return out
}

func deploymentFromItem(ns string, item map[string]any, res Resource) DeploymentStatus {
	desired := 0
	ready, updated, available, unavailable := 0, 0, 0, 0
	if res.Replicas != nil {
		desired = res.Replicas.Desired
		ready = res.Replicas.Ready
		updated = res.Replicas.Updated
		available = res.Replicas.Available
		unavailable = res.Replicas.Unavailable
	}
	gen := asInt64(nested(item, "metadata", "generation"))
	obs := asInt64(nested(item, "status", "observedGeneration"))
	rolling := unavailable > 0 || (desired > 0 && (ready < desired || updated < desired)) || (gen > 0 && obs > 0 && gen != obs)
	return DeploymentStatus{
		Name: res.Name, Namespace: ns, Labels: res.Labels, Selector: res.Selector,
		Replicas: desired, ReadyReplicas: ready, UpdatedReplicas: updated,
		AvailableReplicas: available, UnavailableReplicas: unavailable,
		Generation: gen, ObservedGeneration: obs,
		Strategy: res.Strategy, MaxUnavailable: res.MaxUnavailable, MaxSurge: res.MaxSurge,
		Images: res.Images, Conditions: conditionsFrom(item), Rolling: rolling,
		MissingRequests: res.MissingRequests,
	}
}

func replicaSetFromItem(ns string, item map[string]any, res Resource) ReplicaSetStatus {
	desired := asInt(nested(item, "spec", "replicas"))
	current := asInt(nested(item, "status", "replicas"))
	ready := asInt(nested(item, "status", "readyReplicas"))
	if res.Replicas != nil {
		if desired == 0 {
			desired = res.Replicas.Desired
		}
		if ready == 0 {
			ready = res.Replicas.Ready
		}
	}
	return ReplicaSetStatus{
		Name: res.Name, Namespace: ns, Owner: res.OwnerName, Labels: res.Labels,
		Desired: desired, Current: current, Ready: ready,
		Generation: asInt64(nested(item, "metadata", "annotations", "deployment.kubernetes.io/revision")),
		Images:     res.Images,
	}
}

func podFromItem(ns string, item map[string]any, res Resource) PodStatus {
	readyN, total := podReadyCount(item)
	req := map[string]string{}
	for _, c := range asList(nested(item, "spec", "containers")) {
		for k, v := range stringMap(nested(asMap(c), "resources", "requests")) {
			req[k] = v
		}
	}
	ready := podConditionReady(item) || (res.Phase == "Running" && total > 0 && readyN == total)
	return PodStatus{
		Name: res.Name, Namespace: ns, Phase: res.Phase, Ready: ready,
		Restarts: res.Restarts, Labels: res.Labels, Reason: res.Reason, Message: res.Message,
		Node: asString(nested(item, "spec", "nodeName")), OwnerKind: res.OwnerKind, OwnerName: res.OwnerName,
		Images: res.Images, CreatedAt: res.CreatedAt, Requests: emptyToNil(req),
	}
}

func serviceFromItem(ns string, item map[string]any, res Resource) ServiceStatus {
	var ports []string
	for _, p := range asList(nested(item, "spec", "ports")) {
		pm := asMap(p)
		s := asIntOrString(pm["port"])
		if name := asString(pm["name"]); name != "" {
			s = name + ":" + s
		}
		if proto := asString(pm["protocol"]); proto != "" && proto != "TCP" {
			s += "/" + proto
		}
		if np := asInt(pm["nodePort"]); np > 0 {
			s += "→" + strconv.Itoa(np)
		}
		ports = append(ports, s)
	}
	typ := asString(nested(item, "spec", "type"))
	if typ == "" {
		typ = "ClusterIP"
	}
	return ServiceStatus{
		Name: res.Name, Namespace: ns, Type: typ,
		ClusterIP: asString(nested(item, "spec", "clusterIP")),
		Ports:     ports, Labels: res.Labels,
	}
}

func quotaFromItem(item map[string]any) *QuotaStatus {
	hard := stringMap(nested(item, "status", "hard"))
	if len(hard) == 0 {
		hard = stringMap(nested(item, "spec", "hard"))
	}
	used := stringMap(nested(item, "status", "used"))
	name := asString(nested(item, "metadata", "name"))
	if name == "" {
		name = "project-quota"
	}
	return &QuotaStatus{Name: name, Hard: hard, Used: used}
}

func conditionsFrom(item map[string]any) []Condition {
	var out []Condition
	for _, c := range asList(nested(item, "status", "conditions")) {
		cm := asMap(c)
		out = append(out, Condition{
			Type: asString(cm["type"]), Status: asString(cm["status"]),
			Reason: asString(cm["reason"]), Message: asString(cm["message"]),
		})
	}
	return out
}

func finalizeStatus(st *NamespaceStatus) {
	if st.Deployments == nil {
		st.Deployments = []DeploymentStatus{}
	}
	if st.ReplicaSets == nil {
		st.ReplicaSets = []ReplicaSetStatus{}
	}
	if st.Pods == nil {
		st.Pods = []PodStatus{}
	}
	if st.Services == nil {
		st.Services = []ServiceStatus{}
	}
	if st.Events == nil {
		st.Events = []EventStatus{}
	}
	if st.Warnings == nil {
		st.Warnings = []string{}
	}
	if st.History == nil {
		st.History = []string{}
	}
	if st.Resources == nil {
		st.Resources = []Resource{}
	}
	sortResources(st.Resources)
	sort.Slice(st.Deployments, func(i, j int) bool { return st.Deployments[i].Name < st.Deployments[j].Name })
	sort.Slice(st.ReplicaSets, func(i, j int) bool {
		if st.ReplicaSets[i].Generation != st.ReplicaSets[j].Generation {
			return st.ReplicaSets[i].Generation > st.ReplicaSets[j].Generation
		}
		return st.ReplicaSets[i].Name < st.ReplicaSets[j].Name
	})
	for i := range st.ReplicaSets {
		st.ReplicaSets[i].Active = replicaSetActive(st.ReplicaSets[i])
	}
	sort.Slice(st.Pods, func(i, j int) bool { return st.Pods[i].Name < st.Pods[j].Name })
	sort.Slice(st.Services, func(i, j int) bool { return st.Services[i].Name < st.Services[j].Name })

	live := len(st.Pods) > 0 || len(st.ReplicaSets) > 0 || hasWarningEvents(st.Events)
	sum := StatusSummary{
		Deployments: len(st.Deployments),
		ReplicaSets: len(st.ReplicaSets),
		Pods:        len(st.Pods),
	}
	seenWarn := map[string]struct{}{}
	addLine := func(dst *[]string, msg string) {
		msg = strings.TrimSpace(msg)
		if msg == "" {
			return
		}
		if _, ok := seenWarn[msg]; ok {
			return
		}
		seenWarn[msg] = struct{}{}
		*dst = append(*dst, msg)
	}
	addWarn := func(msg string) { addLine(&st.Warnings, msg) }
	addHistory := func(msg string) { addLine(&st.History, msg) }

	for _, d := range st.Deployments {
		if d.Replicas > 0 && d.ReadyReplicas >= d.Replicas && !d.Rolling {
			sum.ReadyDeployments++
		}
		if d.MissingRequests {
			addWarn(fmt.Sprintf("Deployment %s 的容器没有 resources.requests.cpu/memory，会被 ResourceQuota project-quota 拦住，Pod 起不来。", d.Name))
		}
		if d.Replicas > 0 && d.ReadyReplicas < d.Replicas && (d.Rolling || live) {
			addWarn(fmt.Sprintf("Deployment %s 就绪 %d/%d，滚动更新未完成。", d.Name, d.ReadyReplicas, d.Replicas))
		}
	}
	for _, p := range st.Pods {
		switch p.Phase {
		case "Running":
			if p.Ready {
				sum.RunningPods++
			} else {
				sum.PendingPods++
			}
		case "Pending":
			sum.PendingPods++
			if p.Reason != "" || p.Message != "" {
				addWarn(fmt.Sprintf("Pod %s 等待中：%s %s", p.Name, p.Reason, p.Message))
			}
		case "Failed", "Unknown":
			sum.FailedPods++
			addWarn(fmt.Sprintf("Pod %s %s：%s %s", p.Name, p.Phase, p.Reason, p.Message))
		case "Succeeded":
		default:
			if p.Phase != "" {
				sum.PendingPods++
			}
		}
	}
	for i, ev := range st.Events {
		if !strings.EqualFold(ev.Type, "Warning") {
			continue
		}
		line := formatWarningEvent(ev)
		if eventIsStale(st, ev) {
			st.Events[i].Stale = true
			addHistory(line)
			continue
		}
		sum.Warnings++
		addWarn(line)
	}
	st.Summary = sum
}

func replicaSetActive(rs ReplicaSetStatus) bool {
	return rs.Desired > 0 || rs.Current > 0 || rs.Ready > 0
}

func formatWarningEvent(ev EventStatus) string {
	line := strings.TrimSpace(ev.Reason + ": " + ev.Message)
	if ev.ObjectKind != "" && ev.ObjectName != "" {
		line = ev.ObjectKind + "/" + ev.ObjectName + " " + line
	}
	if looksLikeQuota(ev.Message) {
		line += "（容器必须声明 resources.requests.cpu 与 resources.requests.memory）"
	}
	return line
}

func eventIsStale(st *NamespaceStatus, ev EventStatus) bool {
	kind := strings.ToLower(strings.TrimSpace(ev.ObjectKind))
	name := strings.TrimSpace(ev.ObjectName)
	switch kind {
	case "replicaset":
		for _, rs := range st.ReplicaSets {
			if rs.Name == name {
				return !replicaSetActive(rs)
			}
		}
		return true
	case "pod":
		for _, p := range st.Pods {
			if p.Name != name {
				continue
			}
			if p.Phase == "Running" && p.Ready {
				return true
			}
			return false
		}
		return true
	case "deployment":
		for _, d := range st.Deployments {
			if d.Name != name {
				continue
			}
			healthy := d.Replicas > 0 && d.ReadyReplicas >= d.Replicas && !d.Rolling && !d.MissingRequests
			return healthy
		}
		return true
	default:
		for _, d := range st.Deployments {
			if d.MissingRequests || d.Rolling || (d.Replicas > 0 && d.ReadyReplicas < d.Replicas) {
				return false
			}
		}
		for _, p := range st.Pods {
			if p.Phase == "Pending" || p.Phase == "Failed" || p.Phase == "Unknown" || (p.Phase == "Running" && !p.Ready) {
				return false
			}
		}
		return true
	}
}

func hasWarningEvents(events []EventStatus) bool {
	for _, ev := range events {
		if strings.EqualFold(ev.Type, "Warning") {
			return true
		}
	}
	return false
}

func looksLikeQuota(msg string) bool {
	m := strings.ToLower(msg)
	return strings.Contains(m, "exceeded quota") ||
		(strings.Contains(m, "forbidden") && strings.Contains(m, "quota")) ||
		strings.Contains(m, "project-quota")
}

func sortResources(res []Resource) {
	sort.Slice(res, func(i, j int) bool {
		if res[i].Kind != res[j].Kind {
			return res[i].Kind < res[j].Kind
		}
		return res[i].Name < res[j].Name
	})
}

func imagesFromContainers(containers []any) []string {
	var out []string
	seen := map[string]struct{}{}
	for _, c := range containers {
		img := asString(asMap(c)["image"])
		if img == "" {
			continue
		}
		if _, ok := seen[img]; ok {
			continue
		}
		seen[img] = struct{}{}
		out = append(out, img)
	}
	return out
}

func containersMissingRequests(containers []any) bool {
	if len(containers) == 0 {
		return false
	}
	for _, c := range containers {
		req := asMap(nested(asMap(c), "resources", "requests"))
		if asString(req["cpu"]) == "" || asString(req["memory"]) == "" {
			return true
		}
	}
	return false
}

func podWait(item map[string]any) (reason, message string) {
	reason = asString(nested(item, "status", "reason"))
	message = asString(nested(item, "status", "message"))
	for _, key := range []string{"containerStatuses", "initContainerStatuses"} {
		for _, c := range asList(nested(item, "status", key)) {
			waiting := asMap(nested(asMap(c), "state", "waiting"))
			if r := asString(waiting["reason"]); r != "" {
				return r, asString(waiting["message"])
			}
			terminated := asMap(nested(asMap(c), "state", "terminated"))
			if r := asString(terminated["reason"]); r != "" {
				return r, asString(terminated["message"])
			}
		}
	}
	return reason, message
}

func podRestarts(item map[string]any) int {
	n := 0
	for _, c := range asList(nested(item, "status", "containerStatuses")) {
		n += asInt(asMap(c)["restartCount"])
	}
	return n
}

func podReadyCount(item map[string]any) (ready, total int) {
	cs := asList(nested(item, "status", "containerStatuses"))
	total = len(cs)
	if total == 0 {
		total = len(asList(nested(item, "spec", "containers")))
	}
	for _, c := range cs {
		if asBool(asMap(c)["ready"]) {
			ready++
		}
	}
	return ready, total
}

func podConditionReady(item map[string]any) bool {
	for _, c := range asList(nested(item, "status", "conditions")) {
		cm := asMap(c)
		if asString(cm["type"]) == "Ready" && strings.EqualFold(asString(cm["status"]), "True") {
			return true
		}
	}
	return false
}

func nested(m map[string]any, keys ...string) any {
	var cur any = m
	for _, k := range keys {
		mm := asMap(cur)
		if mm == nil {
			return nil
		}
		cur = mm[k]
	}
	return cur
}

func asMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

func asList(v any) []any {
	x, _ := v.([]any)
	return x
}

func asString(v any) string {
	if v == nil {
		return ""
	}
	switch n := v.(type) {
	case string:
		return n
	case fmt.Stringer:
		return n.String()
	default:
		return strings.TrimSpace(fmt.Sprint(v))
	}
}

func asInt(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int32:
		return int(n)
	case int64:
		return int(n)
	case uint:
		return int(n)
	case uint32:
		return int(n)
	case uint64:
		return int(n)
	case float64:
		return int(n)
	case float32:
		return int(n)
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	case string:
		i, err := strconv.Atoi(strings.TrimSpace(n))
		if err == nil {
			return i
		}
	}
	return 0
}

func asInt64(v any) int64 {
	return int64(asInt(v))
}

func asIntOrString(v any) string {
	if v == nil {
		return ""
	}
	switch n := v.(type) {
	case string:
		return n
	case int, int32, int64, uint, uint32, uint64, float64, float32, json.Number:
		return strconv.Itoa(asInt(v))
	default:
		s := strings.TrimSpace(fmt.Sprint(v))
		if s == "<nil>" {
			return ""
		}
		return s
	}
}

func asBool(v any) bool {
	switch n := v.(type) {
	case bool:
		return n
	case string:
		return strings.EqualFold(n, "true")
	}
	return false
}

func stringMap(v any) map[string]string {
	m := asMap(v)
	if len(m) == 0 {
		return nil
	}
	out := map[string]string{}
	for k, val := range m {
		s := asString(val)
		if s == "" {
			continue
		}
		out[k] = s
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func emptyToNil(m map[string]string) map[string]string {
	if len(m) == 0 {
		return nil
	}
	return m
}

func nz(v, fallback string) string {
	if strings.TrimSpace(v) == "" {
		return fallback
	}
	return v
}

func eventTime(s string) time.Time {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t
	}
	return time.Time{}
}

func copyStringMap(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}
