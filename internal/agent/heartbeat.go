package agent

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"runtime"
	"time"

	"ha-cluster/internal/models"
)

type Status struct {
	Name            string `json:"name"`
	Arch            string `json:"arch"`
	Class           string `json:"class"`
	Role            string `json:"role"`
	Power           string `json:"power"`
	FabricIP        string `json:"fabric_ip"`
	AllocatableCPU  int64  `json:"allocatable_cpu_milli"`
	AllocatableMem  int64  `json:"allocatable_mem_bytes"`
	AllocatableDisk int64  `json:"allocatable_disk_bytes"`
	FabricPath      string `json:"fabric_path"`
	FabricRTTMS     int64  `json:"fabric_rtt_ms"`
}

func DetectStatus(name, fabricIP string, cpu, mem, disk int64) Status {
	arch := runtime.GOARCH
	if arch == "x86_64" {
		arch = models.ArchAMD64
	}
	if cpu == 0 || mem == 0 {
		c, m := HostCapacity()
		if cpu == 0 {
			cpu = c
		}
		if mem == 0 {
			mem = m
		}
	}
	if disk == 0 {
		disk = 40 << 30
	}
	return Status{
		Name: name, Arch: arch, Class: "desktop", Role: "worker", Power: "mains",
		FabricIP: fabricIP, AllocatableCPU: cpu, AllocatableMem: mem, AllocatableDisk: disk,
		FabricPath: "p2p", FabricRTTMS: 1,
	}
}

func PostHeartbeat(client *http.Client, apiURL string, st Status, token ...string) error {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	b, _ := json.Marshal(st)
	req, err := http.NewRequest(http.MethodPost, apiURL+"/nodes/heartbeat", bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	tok := ""
	if len(token) > 0 && token[0] != "" {
		tok = token[0]
	} else if v := os.Getenv("HA_NODE_TOKEN"); v != "" {
		tok = v
	} else if v := os.Getenv("HA_INTERNAL_TOKEN"); v != "" {
		tok = v
	}
	if tok != "" {
		req.Header.Set("X-HA-Node-Token", tok)
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return errStatus(resp.StatusCode)
	}
	return nil
}

type httpStatusError int

func (e httpStatusError) Error() string { return http.StatusText(int(e)) }

func errStatus(code int) error { return httpStatusError(code) }
