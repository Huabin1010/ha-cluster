package setup

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

type JoinSpec struct {
	Token       string
	Cluster     string
	ETNet       string
	ETPeer      string
	ETSecret    string
	API         string
	K3S         string
	K3SToken    string
	K3SRole     string
	Depot       string
	DepotPublic string
	Role        string
	Power       string
	Class       string
	FabricIP    string
	NodeToken   string
	RootDir     string
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
	nodeTok := q.Get("node_token")
	if nodeTok == "" {
		nodeTok = q.Get("token")
	}
	return JoinSpec{
		Token:       raw,
		Cluster:     cluster,
		ETNet:       q.Get("et_net"),
		ETPeer:      q.Get("et_peer"),
		ETSecret:    q.Get("et_secret"),
		API:         q.Get("api"),
		K3S:         q.Get("k3s"),
		K3SToken:    q.Get("k3s_token"),
		K3SRole:     q.Get("k3s_role"),
		Depot:       q.Get("depot"),
		DepotPublic: q.Get("depot_public"),
		FabricIP:    q.Get("fabric_ip"),
		NodeToken:   nodeTok,
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
	fabric, err := NormalizeStaticIPv4(spec.FabricIP)
	if err != nil {
		return err
	}
	spec.FabricIP = fabric
	if err := CheckFabricIPConflict(fabric); err != nil {
		return err
	}
	nodeTok := spec.NodeToken
	if nodeTok == "" {
		nodeTok = os.Getenv("HA_NODE_TOKEN")
	}
	depot := effectiveDepot(spec)
	etSecret := strings.TrimSpace(spec.ETSecret)
	if etSecret == "" {
		etSecret = strings.TrimSpace(os.Getenv("HA_ET_SECRET"))
	}
	k3sRole := spec.K3SRole
	if k3sRole == "" {
		k3sRole = "auto"
	}
	env := fmt.Sprintf("HA_CLUSTER=%s\nHA_ET_NET=%s\nHA_ET_PEER=%s\nHA_ET_SECRET=%s\nHA_API=%s\nHA_K3S=%s\nHA_K3S_TOKEN=%s\nHA_K3S_ROLE=%s\nHA_DEPOT=%s\nHA_DEPOT_PUBLIC=%s\nHA_ROLE=%s\nHA_POWER=%s\nHA_CLASS=%s\nHA_FABRIC_IP=%s\nHA_NODE_TOKEN=%s\nHA_NODE_TAGS=\n",
		spec.Cluster, spec.ETNet, spec.ETPeer, etSecret, spec.API, spec.K3S, spec.K3SToken, k3sRole, depot, spec.DepotPublic, spec.Role, power, class, fabric, nodeTok)
	if err := os.WriteFile(filepath.Join(root, "join.env"), []byte(env), 0600); err != nil {
		return err
	}
	execStart := "ExecStart=/usr/local/bin/easytier-core --ipv4 ${HA_FABRIC_IP}/24 --network-name ${HA_ET_NET} --peers ${HA_ET_PEER}"
	if etSecret != "" {
		execStart += " --network-secret ${HA_ET_SECRET}"
	}
	unit := `[Unit]
Description=ha-cluster EasyTier
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=` + filepath.Join(root, "join.env") + `
` + execStart + `
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
ExecStart=/usr/local/bin/ha-agent --api ${HA_API} --fabric-ip ${HA_FABRIC_IP} --power ${HA_POWER} --class ${HA_CLASS} --token ${HA_NODE_TOKEN} --tags ${HA_NODE_TAGS} --once=false
Restart=always

[Install]
WantedBy=multi-user.target
`
	return os.WriteFile(filepath.Join(root, "ha-agent.service"), []byte(agent), 0644)
}

func EasyTierCommand(spec JoinSpec, ipv4 string) []string {
	addr := strings.TrimSpace(ipv4)
	if addr != "" && !strings.Contains(addr, "/") {
		addr += "/24"
	}
	cmd := []string{
		"easytier-core",
		"--ipv4", addr,
		"--network-name", spec.ETNet,
		"--peers", spec.ETPeer,
	}
	if secret := strings.TrimSpace(spec.ETSecret); secret != "" {
		cmd = append(cmd, "--network-secret", secret)
	}
	return cmd
}
