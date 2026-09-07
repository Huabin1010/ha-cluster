package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"ha-cluster/internal/agent"
)

func main() {
	var (
		api    = flag.String("api", env("HA_API", "http://127.0.0.1:8080"), "ha-api base URL")
		name   = flag.String("name", hostname(), "node name")
		fabric = flag.String("fabric-ip", env("HA_FABRIC_IP", ""), "EasyTier IPv4 (or LAN for debug)")
		power  = flag.String("power", env("HA_POWER", "mains"), "mains|battery")
		class  = flag.String("class", env("HA_CLASS", "desktop"), "phone|sbc|desktop|server|cloud")
		cpu     = flag.Int64("cpu-milli", 0, "allocatable millicores (0=auto)")
		mem     = flag.Int64("mem-bytes", 0, "allocatable memory (0=auto)")
		disk    = flag.Int64("disk-bytes", 0, "allocatable disk (0=auto probe with reserve)")
		storage = flag.String("storage-path", env("HA_STORAGE_PATH", ""), "storage path for disk probe (default /var/lib/incus or /)")
		every   = flag.Duration("interval", 15*time.Second, "heartbeat interval")
		once    = flag.Bool("once", false, "send one heartbeat and exit")
		token   = flag.String("token", env("HA_NODE_TOKEN", env("HA_INTERNAL_TOKEN", "")), "node authentication token")
		listen  = flag.String("listen", env("HA_AGENT_LISTEN", ":9091"), "orchestration listen address (empty or 'none' to disable)")
	)
	flag.Parse()
	st := agent.DetectStatus(*name, *fabric, *cpu, *mem, *disk, *storage)
	st.Power = *power
	st.Class = *class
	if st.FabricIP == "" {
		st.FabricIP = env("HA_FABRIC_IP", "127.0.0.1")
	}

	// Retry initial heartbeat with backoff
	var lastErr error
	for attempt := 0; attempt < 5; attempt++ {
		if attempt > 0 {
			wait := time.Duration(1<<attempt) * time.Second
			log.Printf("retrying initial heartbeat in %v...", wait)
			time.Sleep(wait)
		}
		if lastErr = agent.PostHeartbeat(nil, *api, st, *token); lastErr == nil {
			break
		}
	}
	if lastErr != nil {
		if *once {
			log.Fatalf("heartbeat failed: %v", lastErr)
		}
		log.Printf("initial heartbeat warning: %v (continuing periodic retry)", lastErr)
	} else {
		log.Printf("heartbeat ok name=%s arch=%s class=%s power=%s cpu=%d mem=%d",
			st.Name, st.Arch, st.Class, st.Power, st.AllocatableCPU, st.AllocatableMem)
	}
	if *once {
		return
	}

	var srv *agent.Server
	if *listen != "" && *listen != "none" {
		srv = agent.NewServer(nil, *token, *listen)
		go func() {
			log.Printf("ha-agent orchestrator listening on %s", *listen)
			if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				log.Printf("orchestrator server error: %v", err)
			}
		}()
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	t := time.NewTicker(*every)
	defer t.Stop()

	for {
		select {
		case <-sigCh:
			log.Printf("ha-agent shutting down gracefully on signal")
			if srv != nil {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				_ = srv.Shutdown(ctx)
				cancel()
			}
			return
		case <-t.C:
			st = agent.DetectStatus(*name, st.FabricIP, *cpu, *mem, *disk, *storage)
			st.Power = *power
			st.Class = *class
			if err := agent.PostHeartbeat(nil, *api, st, *token); err != nil {
				log.Printf("heartbeat: %v", err)
			}
		}
	}
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func hostname() string {
	h, err := os.Hostname()
	if err != nil {
		return "node"
	}
	return h
}
