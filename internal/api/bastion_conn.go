package api

import (
	"os"
	"strconv"
	"strings"

	"ha-cluster/internal/bastion"
	"ha-cluster/internal/models"
)

type sshConnInfo struct {
	Command    string
	SCPExample string
	Host       string
	Port       int
	User       string
	Note       string
	Mode       string
	Via        string
}

func bastionDirectSSH() bool {
	if v := strings.TrimSpace(os.Getenv("HA_BASTION_DIRECT")); v != "" {
		return v == "1" || strings.EqualFold(v, "true") || strings.EqualFold(v, "yes")
	}
	// PVE 实验室常未部署跳板；与 API→agent 走 LAN 的配置对齐。
	if v := strings.TrimSpace(os.Getenv("HA_AGENT_VIA_LAN")); v != "" {
		return v == "1" || strings.EqualFold(v, "true") || strings.EqualFold(v, "yes")
	}
	return false
}

func workspaceSSHUser() string {
	if v := strings.TrimSpace(os.Getenv("HA_WS_SSH_USER")); v != "" {
		return v
	}
	return "root"
}

func buildSSHConnection(ws *models.Workspace, n *models.Node, actor *models.User, mem *models.Membership) sshConnInfo {
	if bastionDirectSSH() {
		return buildDirectSSHConnection(ws, n, actor, mem)
	}
	return buildBastionSSHConnection(ws, actor)
}

func buildDirectSSHConnection(ws *models.Workspace, n *models.Node, actor *models.User, mem *models.Membership) sshConnInfo {
	tg, err := bastion.Resolve(*ws, *n, *actor, mem)
	if err != nil {
		return sshConnInfo{
			Mode: "direct",
			Note: "工作区暂不可直连：" + err.Error(),
		}
	}
	user := workspaceSSHUser()
	port := tg.Port
	host := tg.Host
	via := tg.Via
	cmd := "ssh -p " + strconv.Itoa(port) + " " + user + "@" + host
	scp := "scp -P " + strconv.Itoa(port) + " ./local-file " + user + "@" + host + ":/root/"
	note := "实验室直连：经节点 " + via + " 地址连接 Workspace SSH 端口。请在平台账户中添加本机 SSH 公钥。"
	if via == "lan" {
		note = "实验室局域网直连（无需本机加入 EasyTier）。请在平台账户中添加本机 SSH 公钥后再连接。"
	}
	return sshConnInfo{
		Command:    cmd,
		SCPExample: scp,
		Host:       host,
		Port:       port,
		User:       user,
		Mode:       "direct",
		Via:        via,
		Note:       note,
	}
}

func buildBastionSSHConnection(ws *models.Workspace, actor *models.User) sshConnInfo {
	host := bastionHost()
	port := bastionSSHPort()
	user := actor.Username
	cmd := "ssh " + user + "@" + host + " -p " + strconv.Itoa(port) + " -t " + ws.ID.String()
	scp := "scp -P " + strconv.Itoa(port) + " -o RequestTTY=force -o RemoteCommand=" + ws.ID.String() +
		" ./local-file " + user + "@" + host + ":/root/"
	return sshConnInfo{
		Command:    cmd,
		SCPExample: scp,
		Host:       host,
		Port:       port,
		User:       user,
		Mode:       "bastion",
		Note:       "每台机器是独立隔离环境（独立进程/文件系统/网络）。添加自己的 SSH 公钥后即可连接跳板；可用 scp 上传文件，主机内已预装 Docker，允许自行拉取镜像。",
	}
}

func buildSSHConfig(ws *models.Workspace, n *models.Node, actor *models.User, mem *models.Membership) string {
	alias := "ha-" + ws.ID.String()[:8]
	if bastionDirectSSH() {
		info := buildDirectSSHConnection(ws, n, actor, mem)
		if info.Host == "" {
			return "# workspace " + ws.ID.String() + " not reachable: " + info.Note + "\n"
		}
		return "# Isolated workspace " + ws.ID.String() + " (direct " + info.Via + ")\n" +
			"# scp: " + info.SCPExample + "\n" +
			"Host " + alias + "\n" +
			"  HostName " + info.Host + "\n" +
			"  User " + info.User + "\n" +
			"  Port " + strconv.Itoa(info.Port) + "\n" +
			"  ForwardAgent yes\n"
	}
	host := bastionHost()
	port := bastionSSHPort()
	user := actor.Username
	return "# Isolated workspace " + ws.ID.String() + "\n" +
		"# scp: scp -P " + strconv.Itoa(port) + " -o RequestTTY=force -o RemoteCommand=" + ws.ID.String() +
		" ./file " + user + "@" + host + ":/root/\n" +
		"Host " + alias + "\n" +
		"  HostName " + host + "\n" +
		"  User " + user + "\n" +
		"  Port " + strconv.Itoa(port) + "\n" +
		"  ForwardAgent yes\n" +
		"  RequestTTY force\n" +
		"  RemoteCommand " + ws.ID.String() + "\n"
}
