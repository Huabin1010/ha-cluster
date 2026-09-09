package api

import (
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"ha-cluster/internal/models"
)

type metricsCollector struct {
	requests   atomic.Uint64
	errors5xx  atomic.Uint64
	durationNS atomic.Uint64
}

var globalMetrics = &metricsCollector{}

func metricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/metrics" {
			next.ServeHTTP(w, r)
			return
		}
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(rec, r)
		globalMetrics.requests.Add(1)
		globalMetrics.durationNS.Add(uint64(time.Since(start).Nanoseconds()))
		if rec.status >= 500 {
			globalMetrics.errors5xx.Add(1)
		}
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (s *Server) metrics(w http.ResponseWriter, r *http.Request) {
	nodes, _ := s.App.Store.ListNodes(r.Context())
	var readyWorkers, degraded, offline int
	var cpuFree, memFree, diskFree int64
	for _, n := range nodes {
		if n.Role == "control-plane" {
			continue
		}
		switch n.HealthStatus {
		case models.NodeDegraded:
			degraded++
		case models.NodeOffline:
			offline++
		}
		if n.Ready {
			readyWorkers++
			cpuFree += n.AllocatableCPU - n.UsedCPU
			memFree += n.AllocatableMem - n.UsedMem
			diskFree += n.AllocatableDisk - n.UsedDisk
		}
	}
	reqs := globalMetrics.requests.Load()
	errs := globalMetrics.errors5xx.Load()
	durNS := globalMetrics.durationNS.Load()
	avgMS := 0.0
	if reqs > 0 {
		avgMS = float64(durNS) / float64(reqs) / 1e6
	}
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	var b stringsBuilder
	b.Printf("# HELP ha_http_requests_total Total HTTP requests\n")
	b.Printf("# TYPE ha_http_requests_total counter\n")
	b.Printf("ha_http_requests_total %d\n", reqs)
	b.Printf("# HELP ha_http_errors_5xx_total Total 5xx responses\n")
	b.Printf("# TYPE ha_http_errors_5xx_total counter\n")
	b.Printf("ha_http_errors_5xx_total %d\n", errs)
	b.Printf("# HELP ha_http_request_duration_avg_ms Average request duration in milliseconds\n")
	b.Printf("# TYPE ha_http_request_duration_avg_ms gauge\n")
	b.Printf("ha_http_request_duration_avg_ms %.3f\n", avgMS)
	b.Printf("# HELP ha_nodes_ready Ready worker nodes\n")
	b.Printf("# TYPE ha_nodes_ready gauge\n")
	b.Printf("ha_nodes_ready %d\n", readyWorkers)
	b.Printf("# HELP ha_nodes_degraded Degraded worker nodes\n")
	b.Printf("# TYPE ha_nodes_degraded gauge\n")
	b.Printf("ha_nodes_degraded %d\n", degraded)
	b.Printf("# HELP ha_nodes_offline Offline worker nodes\n")
	b.Printf("# TYPE ha_nodes_offline gauge\n")
	b.Printf("ha_nodes_offline %d\n", offline)
	b.Printf("# HELP ha_pool_cpu_milli_free Free CPU millicores on ready workers\n")
	b.Printf("# TYPE ha_pool_cpu_milli_free gauge\n")
	b.Printf("ha_pool_cpu_milli_free %d\n", cpuFree)
	b.Printf("# HELP ha_pool_mem_bytes_free Free memory bytes on ready workers\n")
	b.Printf("# TYPE ha_pool_mem_bytes_free gauge\n")
	b.Printf("ha_pool_mem_bytes_free %d\n", memFree)
	b.Printf("# HELP ha_pool_disk_bytes_free Free disk bytes on ready workers\n")
	b.Printf("# TYPE ha_pool_disk_bytes_free gauge\n")
	b.Printf("ha_pool_disk_bytes_free %d\n", diskFree)
	_, _ = w.Write([]byte(b.String()))
}

type stringsBuilder struct {
	mu sync.Mutex
	buf []byte
}

func (s *stringsBuilder) Printf(format string, args ...any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.buf = append(s.buf, []byte(fmt.Sprintf(format, args...))...)
}

func (s *stringsBuilder) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return string(s.buf)
}
