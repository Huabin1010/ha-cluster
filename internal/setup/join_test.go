package setup

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseAndWriteJoin(t *testing.T) {
	raw := "ha://join/c1/secret?et_net=ha-c1&et_peer=tcp://server.mnnumath.vip:11010&api=https://10.88.0.1:8443&k3s=https://10.88.0.1:6443&depot=http://10.88.0.1:9090"
	spec, err := ParseJoinToken(raw)
	if err != nil {
		t.Fatal(err)
	}
	if spec.ETNet != "ha-c1" || spec.Cluster != "c1" {
		t.Fatalf("%+v", spec)
	}
	dir := t.TempDir()
	spec.RootDir = dir
	spec.Role = "worker"
	if err := WriteJoinFiles(spec); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(filepath.Join(dir, "join.env"))
	if !strings.Contains(string(b), "HA_ET_NET=ha-c1") {
		t.Fatal(string(b))
	}
	if !strings.Contains(string(b), "HA_POWER=mains") || !strings.Contains(string(b), "HA_CLASS=desktop") {
		t.Fatal(string(b))
	}
	if !strings.Contains(string(b), "HA_FABRIC_IP=") {
		t.Fatal(string(b))
	}
	if _, err := os.Stat(filepath.Join(dir, "easytier.service")); err != nil {
		t.Fatal(err)
	}
	cmd := EasyTierCommand(spec, "10.88.0.10")
	if cmd[0] != "easytier-core" {
		t.Fatal(cmd)
	}
}
