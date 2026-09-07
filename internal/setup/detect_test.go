package setup

import "testing"

func TestPayloadName(t *testing.T) {
	if PayloadName("amd64") != "ha-payload-linux-amd64.tar.zst" {
		t.Fatal(PayloadName("amd64"))
	}
	if PayloadName("aarch64") != "ha-payload-linux-arm64.tar.zst" {
		t.Fatal()
	}
	if PayloadName("ppc64") != "" {
		t.Fatal()
	}
}

func TestArchMismatch(t *testing.T) {
	if !ArchMismatch("amd64", "arm64") {
		t.Fatal("must reject")
	}
	if ArchMismatch("x86_64", "amd64") {
		t.Fatal("aliases")
	}
}

func TestRejectServerOnBattery(t *testing.T) {
	if !RejectServerOnBattery("server", "battery") {
		t.Fatal()
	}
	if RejectServerOnBattery("worker", "battery") {
		t.Fatal()
	}
}

func TestJoinTokenValid(t *testing.T) {
	if !JoinTokenValid("ha://join/c1/sec?et_net=ha-x") {
		t.Fatal()
	}
	if JoinTokenValid("https://evil") {
		t.Fatal()
	}
}
