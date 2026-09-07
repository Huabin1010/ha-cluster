package agent

import (
	"bufio"
	"os"
	"strconv"
	"strings"
)

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
