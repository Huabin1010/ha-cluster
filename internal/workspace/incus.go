package workspace

import (
	"archive/tar"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
)

func allocateHostPort(minPort, maxPort int) (int, error) {
	for port := minPort; port <= maxPort; port++ {
		l, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", port))
		if err == nil {
			_ = l.Close()
			return port, nil
		}
	}
	return 0, fmt.Errorf("no free host port in range %d-%d", minPort, maxPort)
}

// IncusRuntime shells out to the incus CLI on this machine.
type IncusRuntime struct {
	Bin   string
	Image string
}

func NewIncusRuntime() *IncusRuntime {
	bin := os.Getenv("HA_INCUS_BIN")
	if bin == "" {
		bin = "incus"
	}
	img := os.Getenv("HA_INCUS_IMAGE")
	if img == "" {
		img = "images:ubuntu/24.04"
	}
	return &IncusRuntime{Bin: bin, Image: img}
}

func Available() bool {
	bin := os.Getenv("HA_INCUS_BIN")
	if bin == "" {
		bin = "incus"
	}
	_, err := exec.LookPath(bin)
	return err == nil
}

func instName(id uuid.UUID) string {
	return "ha-" + strings.ReplaceAll(id.String()[:8], "-", "")
}

func (r *IncusRuntime) cmd(ctx context.Context, args ...string) *exec.Cmd {
	c := exec.CommandContext(ctx, r.Bin, args...)
	c.Env = os.Environ()
	return c
}

func (r *IncusRuntime) Launch(ctx context.Context, w models.Workspace, node models.Node, sshKeys []string) (Instance, error) {
	lc := LaunchContextFrom(ctx, sshKeys)
	spec := w.Spec()
	name := instName(w.ID)
	mem := fmt.Sprintf("%dMiB", spec.MemBytes/(1024*1024))
	cpu := fmt.Sprintf("%d", spec.CPUMilli/1000)
	if spec.CPUMilli < 1000 {
		cpu = "1"
	}
	args := []string{"launch", r.Image, name,
		"--config", "limits.memory=" + mem,
		"--config", "limits.cpu=" + cpu,
		"--config", "limits.processes=512",
		"--config", "security.nesting=true",
	}
	if pool := r.ensureQuotaPool(ctx); pool != "" {
		args = append(args, "--storage", pool)
	}
	if size := diskSizeArg(spec.DiskBytes); size != "" {
		args = append(args, "-d", "root,size="+size)
	}
	out, err := r.cmd(ctx, args...).CombinedOutput()
	if err != nil {
		return Instance{}, fmt.Errorf("incus launch: %w: %s", err, out)
	}
	if err := r.waitContainerExecReady(ctx, name); err != nil {
		_ = r.Destroy(context.Background(), w.ID)
		return Instance{}, err
	}
	if err := r.ensureContainerNetwork(ctx, name); err != nil {
		_ = r.Destroy(context.Background(), w.ID)
		return Instance{}, err
	}
	if err := r.waitContainerIPv4(ctx, name); err != nil {
		_ = r.Destroy(context.Background(), w.ID)
		return Instance{}, fmt.Errorf("container network: %w", err)
	}
	if err := r.applyRootSize(ctx, name, diskSizeArg(spec.DiskBytes)); err != nil {
		_ = r.Destroy(context.Background(), w.ID)
		return Instance{}, err
	}

	hostPort, err := allocateHostPort(22001, 23999)
	if err != nil {
		_ = r.Destroy(context.Background(), w.ID)
		return Instance{}, fmt.Errorf("allocate ssh port: %w", err)
	}
	proxyArgs := []string{"config", "device", "add", name, "ssh-proxy", "proxy",
		fmt.Sprintf("listen=tcp:0.0.0.0:%d", hostPort),
		"connect=tcp:127.0.0.1:22",
	}
	if out, err := r.cmd(ctx, proxyArgs...).CombinedOutput(); err != nil {
		_ = r.Destroy(context.Background(), w.ID)
		return Instance{}, fmt.Errorf("incus proxy device add: %w: %s", err, out)
	}

	if out, err := r.cmd(ctx, "exec", name, "--", "mkdir", "-p", "/var/lib/ha-workspace").CombinedOutput(); err != nil {
		_ = r.Destroy(context.Background(), w.ID)
		return Instance{}, fmt.Errorf("workspace dir: %w: %s", err, out)
	}

	if len(lc.SSHKeys) > 0 {
		var injectErr error
		for attempt := 0; attempt < 3; attempt++ {
			if attempt > 0 {
				select {
				case <-ctx.Done():
					injectErr = ctx.Err()
					break
				case <-time.After(500 * time.Millisecond):
				}
			}
			injectErr = r.injectKeys(ctx, name, lc.SSHKeys)
			if injectErr == nil {
				break
			}
		}
		if injectErr != nil {
			_ = r.Destroy(context.Background(), w.ID)
			return Instance{}, fmt.Errorf("inject keys failed: %w", injectErr)
		}
	}
	if err := r.ensureSSH(ctx, name); err != nil {
		_ = r.Destroy(context.Background(), w.ID)
		return Instance{}, fmt.Errorf("workspace ssh: %w", err)
	}
	if err := r.installWorkspaceDocker(ctx, name); err != nil {
		_ = r.Destroy(context.Background(), w.ID)
		return Instance{}, fmt.Errorf("install workspace docker: %w", err)
	}
	if len(lc.DockerRegistries) > 0 {
		if err := r.injectDockerRegistries(ctx, name, lc.DockerRegistries); err != nil {
			_ = r.Destroy(context.Background(), w.ID)
			return Instance{}, fmt.Errorf("inject docker registries failed: %w", err)
		}
	}
	return Instance{
		ID: w.ID, NodeID: node.ID, SSHPort: hostPort,
		HostKeyFP: "incus:" + name, Running: true,
	}, nil
}

func (r *IncusRuntime) injectKeys(ctx context.Context, name string, keys []string) error {
	dir, err := os.MkdirTemp("", "ha-ssh-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	auth := filepath.Join(dir, "authorized_keys")
	if err := os.WriteFile(auth, []byte(strings.Join(keys, "\n")+"\n"), 0600); err != nil {
		return err
	}
	if out, err := r.cmd(ctx, "exec", name, "--", "mkdir", "-p", "/root/.ssh").CombinedOutput(); err != nil {
		return fmt.Errorf("mkdir .ssh: %w: %s", err, out)
	}
	if out, err := r.cmd(ctx, "file", "push", auth, name+"/root/.ssh/authorized_keys").CombinedOutput(); err != nil {
		return fmt.Errorf("file push: %w: %s", err, out)
	}
	if out, err := r.cmd(ctx, "exec", name, "--", "chmod", "700", "/root/.ssh").CombinedOutput(); err != nil {
		return fmt.Errorf("chmod .ssh: %w: %s", err, out)
	}
	if out, err := r.cmd(ctx, "exec", name, "--", "chmod", "600", "/root/.ssh/authorized_keys").CombinedOutput(); err != nil {
		return fmt.Errorf("chmod authorized_keys: %w: %s", err, out)
	}
	_ = r.cmd(ctx, "exec", name, "--", "chown", "-R", "root:root", "/root/.ssh").Run()
	return nil
}

func dockerConfigJSON(regs []models.DockerRegistryCred) ([]byte, error) {
	auths := map[string]map[string]string{}
	for _, reg := range regs {
		if reg.Server == "" {
			continue
		}
		auth := base64.StdEncoding.EncodeToString([]byte(reg.Username + ":" + reg.Password))
		auths["https://"+reg.Server] = map[string]string{"auth": auth}
		auths[reg.Server] = map[string]string{"auth": auth}
	}
	return json.Marshal(map[string]any{"auths": auths})
}

func packWorkspaceDebsTar(debsDir string, debs []string) (string, error) {
	f, err := os.CreateTemp("", "ha-docker-debs-*.tar")
	if err != nil {
		return "", err
	}
	path := f.Name()
	tw := tar.NewWriter(f)
	for _, deb := range debs {
		src := filepath.Join(debsDir, deb)
		info, err := os.Stat(src)
		if err != nil {
			_ = tw.Close()
			_ = f.Close()
			_ = os.Remove(path)
			return "", err
		}
		hdr, err := tar.FileInfoHeader(info, "")
		if err != nil {
			_ = tw.Close()
			_ = f.Close()
			_ = os.Remove(path)
			return "", err
		}
		hdr.Name = deb
		if err := tw.WriteHeader(hdr); err != nil {
			_ = tw.Close()
			_ = f.Close()
			_ = os.Remove(path)
			return "", err
		}
		r, err := os.Open(src)
		if err != nil {
			_ = tw.Close()
			_ = f.Close()
			_ = os.Remove(path)
			return "", err
		}
		if _, err := io.Copy(tw, r); err != nil {
			_ = r.Close()
			_ = tw.Close()
			_ = f.Close()
			_ = os.Remove(path)
			return "", err
		}
		_ = r.Close()
	}
	if err := tw.Close(); err != nil {
		_ = f.Close()
		_ = os.Remove(path)
		return "", err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(path)
		return "", err
	}
	return path, nil
}

func (r *IncusRuntime) waitContainerExecReady(ctx context.Context, name string) error {
	for attempt := 0; attempt < 60; attempt++ {
		if _, err := r.cmd(ctx, "exec", name, "--", "true").CombinedOutput(); err == nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
	return fmt.Errorf("container %s not exec-ready", name)
}

// ensureContainerNetwork 为 cloud rootfs 导入的镜像补 eth0 DHCP（cloud-init 在 bake 后常为 disabled）。
func (r *IncusRuntime) ensureContainerNetwork(ctx context.Context, name string) error {
	script := `set -e
mkdir -p /etc/systemd/network
cat >/etc/systemd/network/10-eth0.network <<'EOF'
[Match]
Name=eth0

[Network]
DHCP=ipv4
EOF
systemctl restart systemd-networkd 2>/dev/null || true
`
	out, err := r.cmd(ctx, "exec", name, "--", "bash", "-lc", script).CombinedOutput()
	if err != nil {
		return fmt.Errorf("configure eth0 dhcp: %w: %s", err, out)
	}
	return nil
}

// waitContainerIPv4 等 eth0 DHCP。不在这里 ping 外网：docker 尚未启动时 NAT 偶发未就绪，
// 硬等 90s ping 会把每次 Launch 拖死。
func (r *IncusRuntime) waitContainerIPv4(ctx context.Context, name string) error {
	check := "ip -4 addr show eth0 2>/dev/null | grep -q 'inet '"
	for attempt := 0; attempt < 25; attempt++ {
		if _, err := r.cmd(ctx, "exec", name, "--", "bash", "-lc", check).CombinedOutput(); err == nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
	out, _ := r.cmd(ctx, "exec", name, "--", "ip", "-4", "addr", "show").CombinedOutput()
	return fmt.Errorf("eth0 has no IPv4 after 25s: %s", strings.TrimSpace(string(out)))
}

func workspaceDebsDir() string {
	if d := strings.TrimSpace(os.Getenv("HA_WORKSPACE_DEBS_DIR")); d != "" {
		return d
	}
	return "/var/lib/ha-cluster/workspace-debs"
}

func (r *IncusRuntime) installWorkspaceDocker(ctx context.Context, name string) error {
	if _, err := r.cmd(ctx, "exec", name, "--", "/usr/bin/docker", "--version").CombinedOutput(); err == nil {
		_ = r.cmd(ctx, "exec", name, "--", "systemctl", "unmask", "docker").Run()
		_ = r.cmd(ctx, "exec", name, "--", "systemctl", "enable", "--now", "docker").Run()
		_ = r.cmd(ctx, "exec", name, "--", "service", "docker", "start").Run()
		if _, err := r.cmd(ctx, "exec", name, "--", "/usr/bin/docker", "info").CombinedOutput(); err != nil {
			time.Sleep(2 * time.Second)
		}
		return nil
	}

	debsDir := workspaceDebsDir()
	entries, err := os.ReadDir(debsDir)
	if err != nil || len(entries) == 0 {
		return fmt.Errorf("docker missing in image and no offline debs under %s (re-run install-incus from Depot)", debsDir)
	}
	var debs []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".deb") {
			continue
		}
		debs = append(debs, e.Name())
	}
	if len(debs) == 0 {
		return fmt.Errorf("no .deb files in %s", debsDir)
	}

	if err := r.waitContainerExecReady(ctx, name); err != nil {
		return err
	}

	tarPath, err := packWorkspaceDebsTar(debsDir, debs)
	if err != nil {
		return err
	}
	defer os.Remove(tarPath)

	if out, err := r.cmd(ctx, "exec", name, "--", "mkdir", "-p", "/tmp/ha-docker-debs").CombinedOutput(); err != nil {
		return fmt.Errorf("mkdir debs in container: %w: %s", err, out)
	}
	if out, err := r.cmd(ctx, "file", "push", tarPath, name+"/tmp/ha-docker-debs.tar").CombinedOutput(); err != nil {
		return fmt.Errorf("push debs tar: %w: %s", err, out)
	}
	script := "export DEBIAN_FRONTEND=noninteractive; " +
		"tar -xf /tmp/ha-docker-debs.tar -C /tmp/ha-docker-debs; " +
		"dpkg -i /tmp/ha-docker-debs/*.deb 2>/dev/null || true; " +
		"apt-get -f install -y -qq -o Dir::Cache::archives=/tmp/ha-docker-debs; " +
		"rm -f /tmp/ha-docker-debs.tar; " +
		"systemctl enable --now docker || service docker start || true"
	if out, err := r.cmd(ctx, "exec", name, "--env", "DEBIAN_FRONTEND=noninteractive", "--", "bash", "-lc", script).CombinedOutput(); err != nil {
		return fmt.Errorf("dpkg docker: %w: %s", err, out)
	}
	if out, err := r.cmd(ctx, "exec", name, "--", "/usr/bin/docker", "--version").CombinedOutput(); err != nil {
		return fmt.Errorf("docker not available after offline install: %w: %s", err, out)
	}
	return nil
}

func (r *IncusRuntime) injectDockerRegistries(ctx context.Context, name string, regs []models.DockerRegistryCred) error {
	raw, err := dockerConfigJSON(regs)
	if err != nil {
		return err
	}
	dir, err := os.MkdirTemp("", "ha-docker-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	cfg := filepath.Join(dir, "config.json")
	if err := os.WriteFile(cfg, raw, 0600); err != nil {
		return err
	}
	if out, err := r.cmd(ctx, "exec", name, "--", "mkdir", "-p", "/root/.docker").CombinedOutput(); err != nil {
		return fmt.Errorf("mkdir .docker: %w: %s", err, out)
	}
	if out, err := r.cmd(ctx, "file", "push", cfg, name+"/root/.docker/config.json").CombinedOutput(); err != nil {
		return fmt.Errorf("push docker config: %w: %s", err, out)
	}
	if out, err := r.cmd(ctx, "exec", name, "--", "chmod", "600", "/root/.docker/config.json").CombinedOutput(); err != nil {
		return fmt.Errorf("chmod docker config: %w: %s", err, out)
	}
	return nil
}

func incusAlreadyRunning(out string) bool {
	s := strings.ToLower(out)
	return strings.Contains(s, "already running")
}

func incusAlreadyStopped(out string) bool {
	s := strings.ToLower(out)
	return strings.Contains(s, "already stopped") ||
		strings.Contains(s, "isn't running") ||
		strings.Contains(s, "is not running") ||
		strings.Contains(s, "not running")
}

func (r *IncusRuntime) Stop(ctx context.Context, id uuid.UUID) error {
	out, err := r.cmd(ctx, "stop", instName(id), "--force").CombinedOutput()
	if err != nil && !incusAlreadyStopped(string(out)) {
		return fmt.Errorf("incus stop: %w: %s", err, out)
	}
	return nil
}

func (r *IncusRuntime) Start(ctx context.Context, id uuid.UUID) error {
	name := instName(id)
	out, err := r.cmd(ctx, "start", name).CombinedOutput()
	if err != nil && !incusAlreadyRunning(string(out)) {
		return fmt.Errorf("incus start: %w: %s", err, out)
	}
	if err := r.waitContainerExecReady(ctx, name); err != nil {
		return err
	}
	if err := r.ensureSSH(ctx, name); err != nil {
		return err
	}
	return nil
}

func (r *IncusRuntime) ensureSSH(ctx context.Context, name string) error {
	if out, err := r.cmd(ctx, "exec", name, "--", "ssh-keygen", "-A").CombinedOutput(); err != nil {
		return fmt.Errorf("ssh-keygen -A: %w: %s", err, out)
	}
	// After cold start, systemd/dbus is often not ready yet; retry then fall back
	// to starting sshd without systemctl so Start is not falsely failed.
	script := `set -e
for i in $(seq 1 45); do
  if systemctl is-system-running >/dev/null 2>&1; then
    break
  fi
  if [ -S /run/systemd/private ] || [ -S /run/dbus/system_bus_socket ] || [ -S /var/run/dbus/system_bus_socket ]; then
    break
  fi
  # Already listening is enough (re-start / already-running paths).
  if ss -lnt 2>/dev/null | grep -qE ':22\\s' || pgrep -x sshd >/dev/null 2>&1; then
    exit 0
  fi
  sleep 1
done
systemctl reset-failed ssh.service ssh.socket 2>/dev/null || true
if systemctl enable --now ssh 2>/dev/null \
  || systemctl enable --now sshd 2>/dev/null \
  || systemctl start ssh 2>/dev/null \
  || systemctl start sshd 2>/dev/null; then
  exit 0
fi
if command -v service >/dev/null 2>&1; then
  service ssh start 2>/dev/null || service sshd start 2>/dev/null || true
fi
if pgrep -x sshd >/dev/null 2>&1; then
  exit 0
fi
if [ -x /usr/sbin/sshd ]; then
  /usr/sbin/sshd || true
fi
if pgrep -x sshd >/dev/null 2>&1 || ss -lnt 2>/dev/null | grep -qE ':22\\s'; then
  exit 0
fi
echo "failed to start sshd" >&2
exit 1
`
	out, err := r.cmd(ctx, "exec", name, "--", "bash", "-lc", script).CombinedOutput()
	if err != nil {
		return fmt.Errorf("ensure ssh: %w: %s", err, out)
	}
	return nil
}

func (r *IncusRuntime) Destroy(ctx context.Context, id uuid.UUID) error {
	out, err := r.cmd(ctx, "delete", instName(id), "--force").CombinedOutput()
	if err != nil {
		return fmt.Errorf("incus delete: %w: %s", err, out)
	}
	return nil
}

func (r *IncusRuntime) Resize(ctx context.Context, w models.Workspace) error {
	name := instName(w.ID)
	spec := w.Spec()
	cpu := spec.CPUMilli / 1000
	if cpu < 1 {
		cpu = 1
	}
	mem := fmt.Sprintf("%dMiB", spec.MemBytes/(1024*1024))
	if out, err := r.cmd(ctx, "config", "set", name,
		fmt.Sprintf("limits.cpu=%d", cpu),
		"limits.memory="+mem,
	).CombinedOutput(); err != nil {
		return fmt.Errorf("incus resize cpu/mem: %w: %s", err, out)
	}
	if err := r.applyRootSize(ctx, name, diskSizeArg(spec.DiskBytes)); err != nil {
		return err
	}
	return nil
}

func (r *IncusRuntime) getProxyPort(ctx context.Context, name, deviceName string) int {
	out, err := r.cmd(ctx, "config", "device", "get", name, deviceName, "listen").CombinedOutput()
	if err == nil {
		s := strings.TrimSpace(string(out))
		if idx := strings.LastIndex(s, ":"); idx >= 0 {
			if p, err := strconv.Atoi(s[idx+1:]); err == nil && p > 0 {
				return p
			}
		}
	}
	return 0
}

func (r *IncusRuntime) Get(ctx context.Context, id uuid.UUID) (Instance, bool) {
	name := instName(id)
	out, err := r.cmd(ctx, "list", name, "-f", "csv").CombinedOutput()
	if err != nil || len(out) == 0 {
		return Instance{}, false
	}
	running := strings.Contains(string(out), "RUNNING")
	port := r.getProxyPort(ctx, name, "ssh-proxy")
	if port == 0 {
		port = 22
	}
	return Instance{ID: id, SSHPort: port, Running: running}, true
}

func (r *IncusRuntime) ExposePort(ctx context.Context, wsID, routeID uuid.UUID, containerPort int) (int, error) {
	name := instName(wsID)
	deviceName := "ing-" + strings.ReplaceAll(routeID.String()[:8], "-", "")
	// 尝试优先使用与容器相同的端口；若被占用，则动态分配 24000-29999 端口
	hostPort := containerPort
	l, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", hostPort))
	if err == nil {
		_ = l.Close()
	} else {
		hostPort, err = allocateHostPort(24000, 29999)
		if err != nil {
			return 0, fmt.Errorf("allocate ingress host port: %w", err)
		}
	}
	args := []string{"config", "device", "add", name, deviceName, "proxy",
		fmt.Sprintf("listen=tcp:0.0.0.0:%d", hostPort),
		fmt.Sprintf("connect=tcp:127.0.0.1:%d", containerPort),
	}
	if out, err := r.cmd(ctx, args...).CombinedOutput(); err != nil {
		return 0, fmt.Errorf("incus proxy add ingress: %w: %s", err, out)
	}
	return hostPort, nil
}

func (r *IncusRuntime) UnexposePort(ctx context.Context, wsID, routeID uuid.UUID) error {
	name := instName(wsID)
	deviceName := "ing-" + strings.ReplaceAll(routeID.String()[:8], "-", "")
	_ = r.cmd(ctx, "config", "device", "remove", name, deviceName).Run()
	return nil
}

func (r *IncusRuntime) SyncKeys(ctx context.Context, id uuid.UUID, keys []string) error {
	name := instName(id)
	return r.injectKeys(ctx, name, keys)
}

func PickRuntime() Runtime {
	if os.Getenv("HA_RUNTIME") == "memory" {
		return NewMemoryRuntime()
	}
	if Available() {
		return NewIncusRuntime()
	}
	if os.Getenv("HA_INCUS_IMAGE") != "" || os.Getenv("HA_REQUIRE_INCUS") == "1" {
		return &brokenRuntime{err: fmt.Errorf("incus CLI not found (set HA_INCUS_IMAGE on worker with Incus installed)")}
	}
	return NewMemoryRuntime()
}

type brokenRuntime struct {
	err error
}

func (b *brokenRuntime) Launch(context.Context, models.Workspace, models.Node, []string) (Instance, error) {
	return Instance{}, b.err
}
func (b *brokenRuntime) Stop(context.Context, uuid.UUID) error           { return b.err }
func (b *brokenRuntime) Start(context.Context, uuid.UUID) error          { return b.err }
func (b *brokenRuntime) Destroy(context.Context, uuid.UUID) error        { return b.err }
func (b *brokenRuntime) Resize(context.Context, models.Workspace) error  { return b.err }
func (b *brokenRuntime) Get(context.Context, uuid.UUID) (Instance, bool) { return Instance{}, false }
func (b *brokenRuntime) ExposePort(context.Context, uuid.UUID, uuid.UUID, int) (int, error) {
	return 0, b.err
}
func (b *brokenRuntime) UnexposePort(context.Context, uuid.UUID, uuid.UUID) error { return b.err }
func (b *brokenRuntime) SyncKeys(context.Context, uuid.UUID, []string) error      { return b.err }
