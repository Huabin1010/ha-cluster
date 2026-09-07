package workspace

import (
	"context"
	"fmt"
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

const dockerCloudInit = `#cloud-config
package_update: true
packages:
  - docker.io
  - rsync
runcmd:
  - [ bash, -lc, "systemctl enable --now docker || true" ]
  - [ bash, -lc, "usermod -aG docker root || true" ]
`

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
		"--config", "security.nesting=true",
		"--config", "cloud-init.user-data=" + dockerCloudInit,
	}
	if spec.DiskBytes > 0 {
		gi := spec.DiskBytes / (1024 * 1024 * 1024)
		if gi < 1 {
			gi = 1
		}
		args = append(args, "-d", fmt.Sprintf("root,size=%dGiB", gi))
	}
	out, err := r.cmd(ctx, args...).CombinedOutput()
	if err != nil {
		return Instance{}, fmt.Errorf("incus launch: %w: %s", err, out)
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

	if len(sshKeys) > 0 {
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
			injectErr = r.injectKeys(ctx, name, sshKeys)
			if injectErr == nil {
				break
			}
		}
		if injectErr != nil {
			_ = r.Destroy(context.Background(), w.ID)
			return Instance{}, fmt.Errorf("inject keys failed: %w", injectErr)
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

func (r *IncusRuntime) Stop(ctx context.Context, id uuid.UUID) error {
	out, err := r.cmd(ctx, "stop", instName(id), "--force").CombinedOutput()
	if err != nil {
		return fmt.Errorf("incus stop: %w: %s", err, out)
	}
	return nil
}

func (r *IncusRuntime) Start(ctx context.Context, id uuid.UUID) error {
	out, err := r.cmd(ctx, "start", instName(id)).CombinedOutput()
	if err != nil {
		return fmt.Errorf("incus start: %w: %s", err, out)
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
	gi := spec.DiskBytes / (1024 * 1024 * 1024)
	if gi < 1 {
		gi = 1
	}
	if out, err := r.cmd(ctx, "config", "device", "set", name, "root", fmt.Sprintf("size=%dGiB", gi)).CombinedOutput(); err != nil {
		return fmt.Errorf("incus resize disk: %w: %s", err, out)
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
	if os.Getenv("HA_RUNTIME") == "incus" || Available() {
		return NewIncusRuntime()
	}
	return NewMemoryRuntime()
}
