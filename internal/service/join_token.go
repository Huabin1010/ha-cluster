package service

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
)

// Depot / Fabric defaults — align with packaging/depot_layout.py + easytier-fabric.mdc.
const (
	defaultJoinCluster      = "ha-cluster"
	defaultJoinAPI          = "https://ha.mnnumath.vip/api"
	defaultJoinDepotPublic  = "https://rustfs.s.ggss.club:50000/typora/ha-cluster"
	defaultJoinDepotLAN     = "http://192.168.1.9:10000/typora/ha-cluster"
	defaultJoinETNet        = "ha-cluster-easytier"
	defaultJoinETPeer       = "tcp://110.40.229.62:15010"
	defaultJoinDepotOverlay = "http://10.129.129.1:9090"
)

type JoinTokenInput struct {
	Cluster     string
	Secret      string
	API         string
	DepotPublic string
	FabricIP    string
	// UseLANDepot forces LAN RustFS root when DepotPublic is empty.
	UseLANDepot bool
	// IncludeOverlayDepot adds token depot= (EasyTier 内加速，可选).
	IncludeOverlayDepot bool
}

type JoinTokenResult struct {
	Cluster     string `json:"cluster"`
	Secret      string `json:"secret"`
	Token       string `json:"token"`
	Command     string `json:"command"`
	InstallURL  string `json:"install_url"`
	DepotPublic string `json:"depot_public"`
	API         string `json:"api"`
	ETNet       string `json:"et_net"`
	ETPeer      string `json:"et_peer"`
	FabricIP    string `json:"fabric_ip"`
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func RandomJoinSecret() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

func DefaultDepotPublic() string {
	return envOr("HA_DEPOT_PUBLIC", defaultJoinDepotPublic)
}

func DefaultDepotLAN() string {
	return envOr("HA_DEPOT_LAN", defaultJoinDepotLAN)
}

func randomLocalFabricIP() (string, error) {
	// 本地 / PVE 测试段 10.129.129.205–.254；避开已占用的 .205–.207，从 .208 起随机。
	var b [1]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	n := 208 + int(b[0]%47) // 208..254
	return fmt.Sprintf("10.129.129.%d", n), nil
}

func apiHost(apiURL string) string {
	u, err := url.Parse(apiURL)
	if err != nil {
		return ""
	}
	host := u.Hostname()
	return host
}

func isPrivateHost(host string) bool {
	ip := net.ParseIP(host)
	if ip == nil {
		return strings.HasSuffix(host, ".local")
	}
	cidrs := []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"}
	for _, c := range cidrs {
		_, n, err := net.ParseCIDR(c)
		if err != nil {
			continue
		}
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

func resolveJoinETPeer(apiURL string, useLAN bool) string {
	if v := strings.TrimSpace(os.Getenv("HA_ET_PEER")); v != "" && !useLAN && !isPrivateHost(apiHost(apiURL)) {
		return v
	}
	if useLAN || isPrivateHost(apiHost(apiURL)) {
		if host := apiHost(apiURL); host != "" {
			return "tcp://" + host + ":15010"
		}
		return "tcp://192.168.1.60:15010"
	}
	return envOr("HA_ET_PEER", defaultJoinETPeer)
}

// IssueJoinToken builds a one-shot sudo install command against Depot (S3).
// Empty secret → server-generated. Command pulls packaging/install.sh from Depot.
func IssueJoinToken(in JoinTokenInput) (*JoinTokenResult, error) {
	cluster := strings.TrimSpace(in.Cluster)
	if cluster == "" {
		cluster = envOr("HA_JOIN_CLUSTER", defaultJoinCluster)
	}
	secret := strings.TrimSpace(in.Secret)
	if secret == "" {
		s, err := RandomJoinSecret()
		if err != nil {
			return nil, err
		}
		secret = s
	}
	apiURL := strings.TrimSpace(in.API)
	if apiURL == "" {
		apiURL = envOr("HA_PUBLIC_API", defaultJoinAPI)
	}
	apiURL = strings.TrimRight(apiURL, "/")

	depot := strings.TrimSpace(in.DepotPublic)
	if depot == "" {
		if in.UseLANDepot {
			depot = DefaultDepotLAN()
		} else {
			depot = DefaultDepotPublic()
		}
	}
	depot = strings.TrimRight(depot, "/")

	fabric := strings.TrimSpace(in.FabricIP)
	if fabric == "" {
		ip, err := randomLocalFabricIP()
		if err != nil {
			return nil, err
		}
		fabric = ip
	}

	etNet := envOr("HA_ET_NET", defaultJoinETNet)
	etPeer := resolveJoinETPeer(apiURL, in.UseLANDepot)

	q := url.Values{}
	q.Set("et_net", etNet)
	q.Set("et_peer", etPeer)
	q.Set("api", apiURL)
	q.Set("depot_public", depot)
	q.Set("fabric_ip", fabric)
	if in.IncludeOverlayDepot || strings.TrimSpace(os.Getenv("HA_JOIN_INCLUDE_DEPOT")) == "1" {
		overlay := envOr("HA_DEPOT", defaultJoinDepotOverlay)
		if overlay != "" {
			q.Set("depot", overlay)
		}
	}

	token := fmt.Sprintf("ha://join/%s/%s?%s", cluster, secret, q.Encode())
	installURL := depot + "/install.sh"
	// HA_DEPOT_PUBLIC 必须与 token 内 depot_public 一致，否则引导脚本拉 ha-setup/lab 会走错根。
	command := fmt.Sprintf(
		"curl -fsSL '%s' | sudo env HA_DEPOT_PUBLIC='%s' bash -s -- join --token '%s'",
		installURL, depot, token,
	)
	return &JoinTokenResult{
		Cluster:     cluster,
		Secret:      secret,
		Token:       token,
		Command:     command,
		InstallURL:  installURL,
		DepotPublic: depot,
		API:         apiURL,
		ETNet:       etNet,
		ETPeer:      etPeer,
		FabricIP:    fabric,
	}, nil
}
