package ingress

import "testing"

func TestIsSubdomainReserved(t *testing.T) {
	cases := []struct {
		domain   string
		reserved bool
	}{
		{"admin.apps.mnnumath.vip", true},
		{"api.example.com", true},
		{"login.test.org", true},
		{"root.domain.com", true},
		{"myapp.apps.mnnumath.vip", false},
		{"demo.example.com", false},
	}
	for _, tc := range cases {
		if got := IsSubdomainReserved(tc.domain); got != tc.reserved {
			t.Errorf("domain %s: expected reserved=%v, got %v", tc.domain, tc.reserved, got)
		}
	}
}
