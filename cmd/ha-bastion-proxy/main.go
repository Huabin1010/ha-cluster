package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/user"
	"strconv"
	"strings"
	"time"

	"ha-cluster/internal/bastion"
	"ha-cluster/internal/models"

	"github.com/google/uuid"
)

func main() {
	loadEnvFile(getenv("HA_BASTION_ENV", "/etc/ha-cluster/bastion.env"))

	api := strings.TrimRight(getenv("HA_API", "http://127.0.0.1:8080"), "/")
	wsID, remoteCmd := parseSessionTarget()
	if wsID == "" {
		fmt.Fprintln(os.Stderr, "usage: ha-bastion-proxy <workspace-uuid> [command...]")
		fmt.Fprintln(os.Stderr, "  (or set RemoteCommand / ssh host <uuid> [cmd] → SSH_ORIGINAL_COMMAND)")
		os.Exit(2)
	}
	uname := sessionUser()

	host, port, via, err := fetchTarget(api, uname, wsID)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	addr := net.JoinHostPort(host, strconv.Itoa(port))
	if getenv("HA_BASTION_PRINT", "") == "1" {
		fmt.Printf("%s via %s\n", addr, via)
		return
	}

	// Raw TCP pipe (ProxyCommand mode). ForceCommand needs nested ssh instead.
	if getenv("HA_BASTION_MODE", "") == "raw" {
		if err := bastion.DialProxy(addr, os.Stdin, os.Stdout, 15*time.Second); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}

	sshUser := getenv("HA_WS_SSH_USER", "root")
	args := []string{
		"-p", strconv.Itoa(port),
		"-o", "BatchMode=yes",
		"-o", "StrictHostKeyChecking=accept-new",
		"-o", "UserKnownHostsFile=/var/lib/ha-bastion/known_hosts",
		"-o", "GlobalKnownHostsFile=/dev/null",
		"-o", "LogLevel=ERROR",
	}
	if remoteCmd == "" {
		args = append([]string{"-tt"}, args...)
	}
	if id := getenv("HA_BASTION_IDENTITY", ""); id != "" {
		args = append(args, "-i", id)
	}
	args = append(args, sshUser+"@"+host)
	if remoteCmd != "" {
		args = append(args, remoteCmd)
	}
	bin := getenv("HA_SSH_BIN", "ssh")
	cmd := exec.Command(bin, args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = os.Environ()
	if err := cmd.Run(); err != nil {
		// Never drop the user into a VPS shell — exit non-zero only.
		fmt.Fprintf(os.Stderr, "bastion: connect %s via %s failed: %v\n", addr, via, err)
		os.Exit(1)
	}
}

func sessionUser() string {
	for _, k := range []string{"USER", "LOGNAME"} {
		if v := os.Getenv(k); v != "" {
			return v
		}
	}
	if u, err := user.Current(); err == nil && u.Username != "" {
		return u.Username
	}
	return ""
}

func loadEnvFile(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		i := strings.IndexByte(line, '=')
		if i <= 0 {
			continue
		}
		k := line[:i]
		v := line[i+1:]
		if os.Getenv(k) == "" {
			_ = os.Setenv(k, v)
		}
	}
}

func parseSessionTarget() (wsID string, remoteCmd string) {
	if len(os.Args) >= 2 {
		id := strings.TrimSpace(os.Args[1])
		if id != "" && !strings.HasPrefix(id, "-") {
			wsID = id
			if len(os.Args) > 2 {
				remoteCmd = strings.TrimSpace(strings.Join(os.Args[2:], " "))
			}
		}
	}
	orig := strings.TrimSpace(os.Getenv("SSH_ORIGINAL_COMMAND"))
	if orig != "" {
		fields := strings.Fields(orig)
		if len(fields) > 0 {
			if wsID == "" {
				wsID = fields[0]
				remoteCmd = strings.TrimSpace(orig[len(fields[0]):])
			} else if remoteCmd == "" {
				if fields[0] == wsID {
					remoteCmd = strings.TrimSpace(orig[len(fields[0]):])
				} else {
					remoteCmd = orig
				}
			}
		}
	}
	return wsID, remoteCmd
}

func workspaceID() string {
	wsID, _ := parseSessionTarget()
	return wsID
}

func fetchTarget(api, uname, wsID string) (host string, port int, via string, err error) {
	internal := getenv("HA_INTERNAL_TOKEN", "")
	tok := getenv("HA_TOKEN", "")

	var body []byte
	var status int

	if internal != "" && uname != "" {
		u := api + "/internal/ssh-target?user=" + url.QueryEscape(uname) + "&id=" + url.QueryEscape(wsID)
		req, _ := http.NewRequest(http.MethodGet, u, nil)
		req.Header.Set("X-HA-Internal", internal)
		status, body, err = doReq(req)
		if err != nil {
			return "", 0, "", err
		}
		if status >= 300 {
			return "", 0, "", fmt.Errorf("ssh-target: %s", strings.TrimSpace(string(body)))
		}
	} else if tok != "" {
		req, _ := http.NewRequest(http.MethodGet, api+"/workspaces/"+wsID+"/ssh-target", nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		status, body, err = doReq(req)
		if err != nil {
			return "", 0, "", err
		}
		if status >= 300 {
			return "", 0, "", fmt.Errorf("ssh-target: %s", strings.TrimSpace(string(body)))
		}
	} else {
		return "", 0, "", fmt.Errorf("set HA_INTERNAL_TOKEN (with USER) or HA_TOKEN")
	}

	var out struct {
		Host           string    `json:"host"`
		Port           int       `json:"port"`
		FabricIP       string    `json:"fabric_ip"`
		LanIP          string    `json:"lan_ip"`
		Breakglass     string    `json:"breakglass"`
		Visibility     string    `json:"visibility"`
		OwnerUserID    uuid.UUID `json:"owner_user_id"`
		ActorUserID    uuid.UUID `json:"actor_user_id"`
		MembershipRole string    `json:"membership_role"`
		IsAdmin        bool      `json:"is_admin"`
		Via            string    `json:"via"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return "", 0, "", err
	}
	parsedID, _ := uuid.Parse(wsID)
	w := models.Workspace{
		ID:          parsedID,
		Status:      models.WSRunning,
		SSHPort:     out.Port,
		Visibility:  out.Visibility,
		OwnerUserID: out.OwnerUserID,
	}
	n := models.Node{
		FabricIP:      firstNonEmpty(out.FabricIP, out.Host),
		LanIP:         out.LanIP,
		BreakglassSSH: out.Breakglass,
	}
	if out.Port == 0 {
		w.SSHPort = 22
	}
	role := out.MembershipRole
	if role == "" {
		role = models.RoleDeveloper
	}
	tg, err := bastion.Resolve(w, n, role, out.ActorUserID, out.IsAdmin)
	if err != nil {
		return "", 0, "", err
	}
	return tg.Host, tg.Port, tg.Via, nil
}

func doReq(req *http.Request) (int, []byte, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, b, nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func getenv(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
