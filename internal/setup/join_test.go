package setup

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseAndWriteJoin(t *testing.T) {
	raw := "ha://join/c1/secret?et_net=ha-c1&et_peer=tcp://server.mnnumath.vip:11010&et_secret=s3cr3t&api=https://10.88.0.1:8443&k3s=https://10.88.0.1:6443&k3s_token=tok&k3s_role=agent&depot=http://10.88.0.1:9090"
	spec, err := ParseJoinToken(raw)
	if err != nil {
		t.Fatal(err)
	}
	if spec.ETNet != "ha-c1" || spec.Cluster != "c1" || spec.ETSecret != "s3cr3t" {
		t.Fatalf("%+v", spec)
	}
	if spec.K3S != "https://10.88.0.1:6443" || spec.K3SToken != "tok" || spec.K3SRole != "agent" {
		t.Fatalf("%+v", spec)
	}
	dir := t.TempDir()
	spec.RootDir = dir
	spec.Role = "worker"
	spec.FabricIP = "10.129.129.210"
	pingFabricIP = func(string) bool { return false }
	t.Cleanup(func() { pingFabricIP = pingIPv4Once })
	if err := WriteJoinFiles(spec); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(filepath.Join(dir, "join.env"))
	if !strings.Contains(string(b), "HA_ET_NET=ha-c1") {
		t.Fatal(string(b))
	}
	if !strings.Contains(string(b), "HA_ET_SECRET=s3cr3t") {
		t.Fatal(string(b))
	}
	if !strings.Contains(string(b), "HA_POWER=mains") || !strings.Contains(string(b), "HA_CLASS=desktop") {
		t.Fatal(string(b))
	}
	if !strings.Contains(string(b), "HA_FABRIC_IP=") {
		t.Fatal(string(b))
	}
	if !strings.Contains(string(b), "HA_K3S=https://10.88.0.1:6443") {
		t.Fatal(string(b))
	}
	if !strings.Contains(string(b), "HA_K3S_ROLE=agent") || !strings.Contains(string(b), "HA_K3S_TOKEN=tok") {
		t.Fatal(string(b))
	}
	unit, _ := os.ReadFile(filepath.Join(dir, "easytier.service"))
	if !strings.Contains(string(unit), "--network-secret ${HA_ET_SECRET}") {
		t.Fatal(string(unit))
	}
	cmd := EasyTierCommand(spec, "10.88.0.10")
	if cmd[0] != "easytier-core" {
		t.Fatal(cmd)
	}
	joined := strings.Join(cmd, " ")
	if !strings.Contains(joined, "--network-secret s3cr3t") {
		t.Fatal(cmd)
	}
	if !strings.Contains(joined, "--ipv4 10.88.0.10/24") {
		t.Fatalf("want static /24, got %s", joined)
	}
	if !strings.Contains(string(unit), "--ipv4 ${HA_FABRIC_IP}/24") {
		t.Fatal(string(unit))
	}
}

func TestWriteJoinFilesRejectsDHCP(t *testing.T) {
	pingFabricIP = func(string) bool { return false }
	t.Cleanup(func() { pingFabricIP = pingIPv4Once })
	err := WriteJoinFiles(JoinSpec{RootDir: t.TempDir(), FabricIP: "dhcp", ETNet: "n", ETPeer: "tcp://x:1"})
	if err == nil || !strings.Contains(err.Error(), "static") {
		t.Fatalf("want static IP error, got %v", err)
	}
}

func TestWriteJoinFilesConflict(t *testing.T) {
	pingFabricIP = func(string) bool { return true }
	t.Cleanup(func() { pingFabricIP = pingIPv4Once })
	err := WriteJoinFiles(JoinSpec{RootDir: t.TempDir(), FabricIP: "10.129.129.230", ETNet: "n", ETPeer: "tcp://x:1"})
	if err == nil || !strings.Contains(err.Error(), "conflict") {
		t.Fatalf("want conflict, got %v", err)
	}
}
