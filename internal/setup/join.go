package setup

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

type JoinSpec struct {
	Token    string
	Cluster  string
	ETNet    string
	ETPeer   string
	API      string
	K3S      string
	Depot        string
	DepotPublic  string
	Role     string
	Power    string
	Class    string
	FabricIP string
	RootDir  string
}

func ParseJoinToken(raw string) (JoinSpec, error) {
	if !JoinTokenValid(raw) {
		return JoinSpec{}, fmt.Errorf("invalid token")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return JoinSpec{}, err
	}
	q := u.Query()
	path := strings.TrimPrefix(u.Path, "/")
	parts := strings.Split(path, "/")
	cluster := ""
	if len(parts) > 0 {
		cluster = parts[0]
	}
	return JoinSpec{
		Token:   raw,
		Cluster: cluster,
		ETNet:   q.Get("et_net"),
		ETPeer:  q.Get("et_peer"),
		API:     q.Get("api"),
		K3S:     q.Get("k3s"),
		Depot:       q.Get("depot"),
		DepotPublic: q.Get("depot_public"),
	}, nil
}

func effectiveDepot(spec JoinSpec) string {
	if spec.Depot != "" {
		return spec.Depot
	}
	return spec.DepotPublic
}

func WriteJoinFiles(spec JoinSpec) error {
	root := spec.RootDir
	if root == "" {
		root = "/var/lib/ha-setup"
	}
	if err := os.MkdirAll(root, 0755); err != nil {
		return err
	}
	power := spec.Power
	if power == "" {
		power = "mains"
	}
	class := spec.Class
	if class == "" {
		class = "desktop"
	}
	fabric := spec.FabricIP
	if fabric == "" {
		fabric = "10.88.0.10"
	}
	depot := effectiveDepot(spec)
	env := fmt.Sprintf("HA_CLUSTER=%s\nHA_ET_NET=%s\nHA_ET_PEER=%s\nHA_API=%s\nHA_K3S=%s\nHA_DEPOT=%s\nHA_DEPOT_PUBLIC=%s\nHA_ROLE=%s\nHA_POWER=%s\nHA_CLASS=%s\nHA_FABRIC_IP=%s\nHA_NODE_TOKEN=%s\n",
		spec.Cluster, spec.ETNet, spec.ETPeer, spec.API, spec.K3S, depot, spec.DepotPublic, spec.Role, power, class, fabric, spec.Token)
	if err := os.WriteFile(filepath.Join(root, "join.env"), []byte(env), 0600); err != nil {
		return err
	}
	unit := `[Unit]
Description=ha-cluster EasyTier
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=` + filepath.Join(root, "join.env") + `
ExecStart=/usr/local/bin/easytier-core --ipv4 ${HA_FABRIC_IP} --network-name ${HA_ET_NET} --peers ${HA_ET_PEER}
Restart=always

[Install]
WantedBy=multi-user.target
`
	if err := os.WriteFile(filepath.Join(root, "easytier.service"), []byte(unit), 0644); err != nil {
		return err
	}
	agent := `[Unit]
Description=ha-cluster agent
After=network-online.target easytier.service

[Service]
EnvironmentFile=` + filepath.Join(root, "join.env") + `
ExecStart=/usr/local/bin/ha-agent --api ${HA_API} --fabric-ip ${HA_FABRIC_IP} --power ${HA_POWER} --class ${HA_CLASS} --token ${HA_NODE_TOKEN} --once=false
Restart=always

[Install]
WantedBy=multi-user.target
`
	return os.WriteFile(filepath.Join(root, "ha-agent.service"), []byte(agent), 0644)
}

func EasyTierCommand(spec JoinSpec, ipv4 string) []string {
	return []string{
		"easytier-core",
		"--ipv4", ipv4,
		"--network-name", spec.ETNet,
		"--peers", spec.ETPeer,
	}
}
