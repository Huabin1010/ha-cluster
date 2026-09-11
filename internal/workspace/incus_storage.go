package workspace

import (
	"context"
	"fmt"
	"os"
	"strings"
)

const (
	defaultQuotaPool = "ha-disk"
	defaultPoolSize  = "20GiB"
)

func diskSizeArg(bytes int64) string {
	if bytes <= 0 {
		return ""
	}
	const gi int64 = 1024 * 1024 * 1024
	const mi int64 = 1024 * 1024
	if bytes%gi == 0 {
		n := bytes / gi
		if n < 1 {
			n = 1
		}
		return fmt.Sprintf("%dGiB", n)
	}
	if bytes%mi == 0 {
		n := bytes / mi
		if n < 1 {
			n = 1
		}
		return fmt.Sprintf("%dMiB", n)
	}
	return fmt.Sprintf("%dB", bytes)
}

func quotaPoolName() string {
	if v := strings.TrimSpace(os.Getenv("HA_INCUS_STORAGE")); v != "" {
		return v
	}
	return defaultQuotaPool
}

func quotaPoolSize() string {
	if v := strings.TrimSpace(os.Getenv("HA_INCUS_POOL_SIZE")); v != "" {
		return v
	}
	return defaultPoolSize
}

func isBlockStorageDriver(driver string) bool {
	switch strings.ToLower(strings.TrimSpace(driver)) {
	case "lvm", "lvmcluster", "zfs", "ceph", "truenas":
		return true
	default:
		return false
	}
}

func parseStorageListCSV(out string) map[string]string {
	pools := map[string]string{}
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, ",")
		if len(parts) < 2 {
			continue
		}
		name := strings.TrimSpace(parts[0])
		driver := strings.TrimSpace(parts[1])
		if name == "" || strings.EqualFold(name, "NAME") {
			continue
		}
		pools[name] = driver
	}
	return pools
}

func (r *IncusRuntime) listStorageDrivers(ctx context.Context) map[string]string {
	out, err := r.cmd(ctx, "storage", "list", "-c", "nD", "--format", "csv").CombinedOutput()
	if err != nil {
		return nil
	}
	return parseStorageListCSV(string(out))
}

// ensureQuotaPool returns an LVM/ZFS/Ceph pool so instance root is a real
// volume. Incus dir pools ignore df: the container still sees the host disk
// even when root size= is set. Empty string means "use the profile default".
func (r *IncusRuntime) ensureQuotaPool(ctx context.Context) string {
	pools := r.listStorageDrivers(ctx)
	want := quotaPoolName()
	if d, ok := pools[want]; ok && isBlockStorageDriver(d) {
		return want
	}
	for name, d := range pools {
		if isBlockStorageDriver(d) {
			return name
		}
	}
	size := quotaPoolSize()
	if out, err := r.cmd(ctx, "storage", "create", want, "lvm", "size="+size).CombinedOutput(); err != nil {
		fmt.Fprintf(os.Stderr, "incus storage create %s lvm: %v: %s\n", want, err, out)
		return ""
	}
	return want
}

func (r *IncusRuntime) applyRootSize(ctx context.Context, name, size string) error {
	if size == "" {
		return nil
	}
	if out, err := r.cmd(ctx, "config", "device", "set", name, "root", "size="+size).CombinedOutput(); err != nil {
		if out2, err2 := r.cmd(ctx, "config", "device", "override", name, "root", "size="+size).CombinedOutput(); err2 != nil {
			return fmt.Errorf("incus root size: %w: %s / %v: %s", err, out, err2, out2)
		}
	}
	return nil
}
