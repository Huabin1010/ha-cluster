package service

import (
	"strings"
	"testing"
)

func TestIssueJoinTokenAutoSecret(t *testing.T) {
	t.Setenv("HA_PUBLIC_API", "https://ha.example/api")
	t.Setenv("HA_DEPOT_PUBLIC", "https://cdn.example/typora/ha-cluster")
	t.Setenv("HA_ET_NET", "ha-cluster-easytier")
	t.Setenv("HA_ET_PEER", "tcp://110.40.229.62:15010")

	out, err := IssueJoinToken(JoinTokenInput{})
	if err != nil {
		t.Fatal(err)
	}
	if out.Cluster != "ha-cluster" {
		t.Fatalf("cluster: %s", out.Cluster)
	}
	if len(out.Secret) != 32 {
		t.Fatalf("secret length: %d", len(out.Secret))
	}
	if out.DepotPublic != "https://cdn.example/typora/ha-cluster" {
		t.Fatalf("depot: %s", out.DepotPublic)
	}
	if out.InstallURL != out.DepotPublic+"/install.sh" {
		t.Fatalf("install_url: %s", out.InstallURL)
	}
	if !strings.Contains(out.Token, "depot_public=") || !strings.Contains(out.Token, "et_net=ha-cluster-easytier") {
		t.Fatalf("token missing params: %s", out.Token)
	}
	if !strings.Contains(out.Command, "curl -fsSL '"+out.InstallURL+"'") {
		t.Fatalf("command should curl install.sh from depot: %s", out.Command)
	}
	if !strings.Contains(out.Command, "sudo env HA_DEPOT_PUBLIC='"+out.DepotPublic+"'") {
		t.Fatalf("command should set HA_DEPOT_PUBLIC for install.sh: %s", out.Command)
	}
	if !strings.Contains(out.Command, "bash -s -- join --token '"+out.Token+"'") {
		t.Fatalf("command should join with token: %s", out.Command)
	}
}

func TestIssueJoinTokenLANDepot(t *testing.T) {
	out, err := IssueJoinToken(JoinTokenInput{
		API: "http://192.168.1.60:8080/api", UseLANDepot: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if out.DepotPublic != defaultJoinDepotLAN {
		t.Fatalf("lan depot: %s", out.DepotPublic)
	}
	if !strings.Contains(out.Command, defaultJoinDepotLAN+"/install.sh") {
		t.Fatalf("command: %s", out.Command)
	}
	if !strings.Contains(out.Token, "api=http%3A%2F%2F192.168.1.60") &&
		!strings.Contains(out.Token, "192.168.1.60") {
		t.Fatalf("token api: %s", out.Token)
	}
}

func TestIssueJoinTokenExplicitSecret(t *testing.T) {
	out, err := IssueJoinToken(JoinTokenInput{
		Cluster: "prod", Secret: "fixed-secret",
		API: "https://ha.mnnumath.vip/api", DepotPublic: "https://rustfs.s.ggss.club:50000/typora/ha-cluster",
	})
	if err != nil {
		t.Fatal(err)
	}
	if out.Secret != "fixed-secret" || out.Cluster != "prod" {
		t.Fatalf("%+v", out)
	}
	if !strings.Contains(out.Token, "/prod/fixed-secret?") {
		t.Fatalf("token: %s", out.Token)
	}
}
