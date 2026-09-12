package service

import "testing"

func TestNextStaticFabricIP(t *testing.T) {
	ip, err := NextStaticFabricIP(nil, FabricPoolProd)
	if err != nil || ip != "10.129.129.10" {
		t.Fatalf("empty prod: %s %v", ip, err)
	}
	ip, err = NextStaticFabricIP([]string{"10.129.129.10", "10.129.129.1"}, FabricPoolProd)
	if err != nil || ip != "10.129.129.11" {
		t.Fatalf("skip used: %s %v", ip, err)
	}
	ip, err = NextStaticFabricIP(nil, FabricPoolLab)
	if err != nil || ip != "10.129.129.205" {
		t.Fatalf("empty lab: %s %v", ip, err)
	}
}

func TestNormalizeStaticFabricIP(t *testing.T) {
	if _, err := NormalizeStaticFabricIP("dhcp"); err == nil {
		t.Fatal("dhcp")
	}
	if _, err := NormalizeStaticFabricIP("10.129.129.1"); err == nil {
		t.Fatal("hub reserved")
	}
	if _, err := NormalizeStaticFabricIP("10.129.129.253"); err == nil {
		t.Fatal("control reserved")
	}
	got, err := NormalizeStaticFabricIP("10.129.129.20/24")
	if err != nil || got != "10.129.129.20" {
		t.Fatalf("cidr: %s %v", got, err)
	}
}
