package k8s

import (
	"bytes"
	"errors"
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

// ErrQuotaBlocked means ResourceQuota (or equivalent admission) would/did
// refuse the workload. HTTP maps this to 409 with the reason in error.
var ErrQuotaBlocked = errors.New("k8s quota blocked")

const maxYAMLBytes = 512 << 10

var clusterKinds = map[string]struct{}{
	"node": {}, "namespace": {}, "persistentvolume": {},
	"clusterrole": {}, "clusterrolebinding": {},
	"storageclass": {}, "customresourcedefinition": {},
	"priorityclass": {}, "volumeattachment": {}, "csidriver": {},
	"mutatingwebhookconfiguration": {}, "validatingwebhookconfiguration": {},
}

type Object struct {
	APIVersion string
	Kind       string
	Name       string
	Namespace  string
	Raw        []byte
}

func SplitAndSanitize(raw string, ns string) ([]Object, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, fmt.Errorf("yaml 不能为空")
	}
	if len(raw) > maxYAMLBytes {
		return nil, fmt.Errorf("yaml 过大")
	}
	var out []Object
	for _, doc := range strings.Split(raw, "\n---") {
		doc = strings.TrimSpace(doc)
		if doc == "" || strings.HasPrefix(doc, "#") && !strings.Contains(doc, "\n") {
			continue
		}
		obj, err := sanitizeDoc(doc, ns)
		if err != nil {
			return nil, err
		}
		if obj.Kind == "" {
			continue
		}
		out = append(out, obj)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("没有可应用的资源")
	}
	return out, nil
}

func ErrIfMissingRequests(objs []Object) error {
	var names []string
	for _, o := range objs {
		switch strings.ToLower(o.Kind) {
		case "pod", "deployment", "statefulset", "daemonset", "job", "cronjob", "replicaset":
		default:
			continue
		}
		if resourceFromObject(o).MissingRequests {
			names = append(names, o.Kind+"/"+o.Name)
		}
	}
	if len(names) == 0 {
		return nil
	}
	return fmt.Errorf("%w: %s 的容器没有 resources.requests.cpu/memory，会被 ResourceQuota project-quota 拦住，Pod 起不来", ErrQuotaBlocked, strings.Join(names, ", "))
}

func WrapApplyError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, ErrQuotaBlocked) {
		return err
	}
	s := strings.TrimSpace(err.Error())
	if looksLikeQuota(s) {
		return fmt.Errorf("%w: %s", ErrQuotaBlocked, s)
	}
	low := strings.ToLower(s)
	if strings.Contains(s, "(Conflict)") || strings.Contains(low, "already exists") {
		return fmt.Errorf("%w: %s", ErrQuotaBlocked, s)
	}
	return err
}

func sanitizeDoc(doc, ns string) (Object, error) {
	var root yaml.Node
	if err := yaml.Unmarshal([]byte(doc), &root); err != nil {
		return Object{}, fmt.Errorf("yaml 无法解析: %w", err)
	}
	if root.Kind != yaml.DocumentNode || len(root.Content) == 0 {
		return Object{}, nil
	}
	m := root.Content[0]
	if m.Kind != yaml.MappingNode {
		return Object{}, fmt.Errorf("yaml 必须是对象")
	}
	kind := mappingString(m, "kind")
	if kind == "" {
		return Object{}, fmt.Errorf("缺少 kind")
	}
	if _, bad := clusterKinds[strings.ToLower(kind)]; bad {
		return Object{}, fmt.Errorf("不允许集群级对象 %s", kind)
	}
	meta := mappingMap(m, "metadata")
	if meta == nil {
		return Object{}, fmt.Errorf("%s 缺少 metadata", kind)
	}
	name := mappingString(meta, "name")
	if name == "" {
		return Object{}, fmt.Errorf("%s 缺少 metadata.name", kind)
	}
	setMappingString(meta, "namespace", ns)
	injectImagePullSecret(m, kind)
	buf, err := yaml.Marshal(m)
	if err != nil {
		return Object{}, err
	}
	return Object{
		APIVersion: mappingString(m, "apiVersion"),
		Kind:       kind,
		Name:       name,
		Namespace:  ns,
		Raw:        bytes.TrimSpace(buf),
	}, nil
}

func injectImagePullSecret(root *yaml.Node, kind string) {
	for _, spec := range podSpecNodes(root, kind) {
		ensureImagePullSecret(spec)
	}
}

func podSpecNodes(root *yaml.Node, kind string) []*yaml.Node {
	switch strings.ToLower(kind) {
	case "pod":
		if spec := mappingMap(root, "spec"); spec != nil {
			return []*yaml.Node{spec}
		}
	case "deployment", "statefulset", "daemonset", "replicaset", "job":
		spec := mappingMap(root, "spec")
		tmpl := mappingMap(spec, "template")
		if pod := mappingMap(tmpl, "spec"); pod != nil {
			return []*yaml.Node{pod}
		}
	case "cronjob":
		spec := mappingMap(root, "spec")
		job := mappingMap(spec, "jobTemplate")
		jobSpec := mappingMap(job, "spec")
		tmpl := mappingMap(jobSpec, "template")
		if pod := mappingMap(tmpl, "spec"); pod != nil {
			return []*yaml.Node{pod}
		}
	}
	return nil
}

func ensureImagePullSecret(spec *yaml.Node) {
	if spec == nil {
		return
	}
	seq := mappingSeq(spec, "imagePullSecrets")
	if seq == nil {
		seq = &yaml.Node{Kind: yaml.SequenceNode, Tag: "!!seq"}
		spec.Content = append(spec.Content,
			&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: "imagePullSecrets"},
			seq,
		)
	}
	for _, item := range seq.Content {
		if mappingString(item, "name") == PullSecretName {
			return
		}
	}
	seq.Content = append(seq.Content, &yaml.Node{
		Kind: yaml.MappingNode, Tag: "!!map",
		Content: []*yaml.Node{
			{Kind: yaml.ScalarNode, Tag: "!!str", Value: "name"},
			{Kind: yaml.ScalarNode, Tag: "!!str", Value: PullSecretName},
		},
	})
}

func mappingSeq(n *yaml.Node, key string) *yaml.Node {
	if n == nil || n.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(n.Content); i += 2 {
		if n.Content[i].Value == key && n.Content[i+1].Kind == yaml.SequenceNode {
			return n.Content[i+1]
		}
	}
	return nil
}

func mappingMap(n *yaml.Node, key string) *yaml.Node {
	if n == nil || n.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(n.Content); i += 2 {
		if n.Content[i].Value == key && n.Content[i+1].Kind == yaml.MappingNode {
			return n.Content[i+1]
		}
	}
	return nil
}

func mappingString(n *yaml.Node, key string) string {
	if n == nil || n.Kind != yaml.MappingNode {
		return ""
	}
	for i := 0; i+1 < len(n.Content); i += 2 {
		if n.Content[i].Value == key {
			return strings.TrimSpace(n.Content[i+1].Value)
		}
	}
	return ""
}

func setMappingString(n *yaml.Node, key, value string) {
	if n == nil || n.Kind != yaml.MappingNode {
		return
	}
	for i := 0; i+1 < len(n.Content); i += 2 {
		if n.Content[i].Value == key {
			n.Content[i+1].Kind = yaml.ScalarNode
			n.Content[i+1].Tag = "!!str"
			n.Content[i+1].Value = value
			return
		}
	}
	n.Content = append(n.Content,
		&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key},
		&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: value},
	)
}

func QuotaFromPlan(cpuMilli, memBytes int64) map[string]string {
	if cpuMilli <= 0 {
		cpuMilli = 500
	}
	if memBytes <= 0 {
		memBytes = 256 << 20
	}
	return map[string]string{
		"requests.cpu":    fmt.Sprintf("%dm", cpuMilli),
		"requests.memory": fmt.Sprintf("%d", memBytes),
		"limits.cpu":      fmt.Sprintf("%dm", cpuMilli*2),
		"limits.memory":   fmt.Sprintf("%d", memBytes),
		"pods":            "20",
		"services":        "10",
	}
}
