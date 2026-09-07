package workspace

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"ha-cluster/internal/models"
)

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
	plan := models.Plans()[w.Plan]
	name := instName(w.ID)
	mem := fmt.Sprintf("%dMiB", plan.MemBytes/(1024*1024))
	cpu := fmt.Sprintf("%d", plan.CPUMilli/1000)
	if plan.CPUMilli < 1000 {
		cpu = "1"
	}
	args := []string{"launch", r.Image, name,
		"--config", "limits.memory=" + mem,
		"--config", "limits.cpu=" + cpu,
		"--config", "security.nesting=false",
	}
	out, err := r.cmd(ctx, args...).CombinedOutput()
	if err != nil {
		return Instance{}, fmt.Errorf("incus launch: %w: %s", err, out)
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
		ID: w.ID, NodeID: node.ID, SSHPort: 22,
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

func (r *IncusRuntime) Get(ctx context.Context, id uuid.UUID) (Instance, bool) {
	out, err := r.cmd(ctx, "list", instName(id), "-f", "csv").CombinedOutput()
	if err != nil || len(out) == 0 {
		return Instance{}, false
	}
	running := strings.Contains(string(out), "RUNNING")
	return Instance{ID: id, SSHPort: 22, Running: running}, true
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
