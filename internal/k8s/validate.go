package k8s

import (
	"bytes"
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

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
