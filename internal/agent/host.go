package agent

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/sys/unix"
)

var (
	cpuMu       sync.Mutex
	lastCPUStat cpuStatSample
)

type cpuStatSample struct {
	total uint64
	idle  uint64
	at    time.Time
}

type DiskUsage struct {
	TotalBytes     uint64 `json:"total_bytes"`
	AvailableBytes uint64 `json:"available_bytes"`
	FreeBytes      uint64 `json:"free_bytes"`
}

func GetDiskUsage(path string) (DiskUsage, error) {
	var stat unix.Statfs_t
	err := unix.Statfs(path, &stat)
	if err != nil {
		return DiskUsage{}, err
	}
	bsize := uint64(stat.Bsize)
	total := stat.Blocks * bsize
	avail := stat.Bavail * bsize
	free := stat.Bfree * bsize
	return DiskUsage{
		TotalBytes:     total,
		AvailableBytes: avail,
		FreeBytes:      free,
	}, nil
}

func HostDiskCapacity(storagePath string) (totalBytes, allocatableBytes int64) {
	if storagePath == "" {
		storagePath = os.Getenv("HA_STORAGE_PATH")
	}
	if storagePath == "" {
		storagePath = "/var/lib/incus"
		if _, err := os.Stat(storagePath); os.IsNotExist(err) {
			storagePath = "/"
		}
	}
	u, err := GetDiskUsage(storagePath)
	if err != nil {
		return 0, 0
	}
	// 扣除预留: max(4GiB, totalBytes * 15%)
	reserve := uint64(4 * 1024 * 1024 * 1024)
	pctReserve := u.TotalBytes * 15 / 100
	if pctReserve > reserve {
		reserve = pctReserve
	}
	var allocatable int64 = 0
	if u.AvailableBytes > reserve {
		allocatable = int64(u.AvailableBytes - reserve)
	}
	return int64(u.TotalBytes), allocatable
}

func HostMemAvailable() int64 {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "MemAvailable:") {
			fs := strings.Fields(line)
			if len(fs) >= 2 {
				kb, _ := strconv.ParseInt(fs[1], 10, 64)
				return kb * 1024
			}
			break
		}
	}
	return 0
}

func readCPUStat() (total, idle uint64, ok bool) {
	b, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0, 0, false
	}
	line := strings.SplitN(string(b), "\n", 2)[0]
	fs := strings.Fields(line)
	if len(fs) < 5 || fs[0] != "cpu" {
		return 0, 0, false
	}
	var fields [8]uint64
	for i := 1; i < len(fs) && i <= 8; i++ {
		v, err := strconv.ParseUint(fs[i], 10, 64)
		if err != nil {
			return 0, 0, false
		}
		fields[i-1] = v
	}
	idle = fields[3]
	total = fields[0] + fields[1] + fields[2] + fields[3] + fields[4]
	return total, idle, true
}

// HostCPUUsagePct returns approximate CPU utilization (0-100) since last call.
func HostCPUUsagePct() float64 {
	total, idle, ok := readCPUStat()
	if !ok {
		return 0
	}
	now := time.Now()
	cpuMu.Lock()
	prev := lastCPUStat
	lastCPUStat = cpuStatSample{total: total, idle: idle, at: now}
	cpuMu.Unlock()
	if prev.at.IsZero() || total < prev.total {
		return 0
	}
	dTotal := float64(total - prev.total)
	dIdle := float64(idle - prev.idle)
	if dTotal <= 0 {
		return 0
	}
	usage := (1 - dIdle/dTotal) * 100
	if usage < 0 {
		return 0
	}
	if usage > 100 {
		return 100
	}
	return usage
}

func HostDiskFree(storagePath string) int64 {
	if storagePath == "" {
		storagePath = os.Getenv("HA_STORAGE_PATH")
	}
	if storagePath == "" {
		storagePath = "/var/lib/incus"
		if _, err := os.Stat(storagePath); os.IsNotExist(err) {
			storagePath = "/"
		}
	}
	u, err := GetDiskUsage(storagePath)
	if err != nil {
		return 0
	}
	return int64(u.AvailableBytes)
}

func HostCapacity() (cpuMilli, memBytes int64) {
	cpuMilli = int64(1) * 1000
	if b, err := os.ReadFile("/proc/cpuinfo"); err == nil {
		n := int64(strings.Count(string(b), "processor"))
		if n > 0 {
			cpuMilli = n * 1000
		}
	}
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return cpuMilli, 0
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "MemTotal:") {
			fs := strings.Fields(line)
			if len(fs) >= 2 {
				kb, _ := strconv.ParseInt(fs[1], 10, 64)
				memBytes = kb * 1024
			}
			break
		}
	}
	// reserve ~800Mi for system
	const reserve = 800 * 1024 * 1024
	if memBytes > reserve {
		memBytes -= reserve
	}
	return cpuMilli, memBytes
}
