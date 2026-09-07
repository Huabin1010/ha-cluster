package main

import (
	"flag"
	"log"
	"os"
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
		cpu    = flag.Int64("cpu-milli", 0, "allocatable millicores (0=auto)")
		mem    = flag.Int64("mem-bytes", 0, "allocatable memory (0=auto)")
		disk   = flag.Int64("disk-bytes", 0, "allocatable disk (0=default 40Gi)")
		every  = flag.Duration("interval", 15*time.Second, "heartbeat interval")
		once   = flag.Bool("once", false, "send one heartbeat and exit")
	)
	flag.Parse()
	st := agent.DetectStatus(*name, *fabric, *cpu, *mem, *disk)
	st.Power = *power
	st.Class = *class
	if st.FabricIP == "" {
		st.FabricIP = env("HA_FABRIC_IP", "127.0.0.1")
	}
	if err := agent.PostHeartbeat(nil, *api, st); err != nil {
		log.Fatal(err)
	}
	log.Printf("heartbeat ok name=%s arch=%s class=%s power=%s cpu=%d mem=%d",
		st.Name, st.Arch, st.Class, st.Power, st.AllocatableCPU, st.AllocatableMem)
	if *once {
		return
	}
	t := time.NewTicker(*every)
	defer t.Stop()
	for range t.C {
		st = agent.DetectStatus(*name, st.FabricIP, *cpu, *mem, *disk)
		st.Power = *power
		st.Class = *class
		if err := agent.PostHeartbeat(nil, *api, st); err != nil {
			log.Printf("heartbeat: %v", err)
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
