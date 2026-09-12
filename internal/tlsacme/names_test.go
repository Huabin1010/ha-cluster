package tlsacme

import "testing"

func TestWildcardNames(t *testing.T) {
	got := WildcardNames("apps.cl.qzsyzn.com")
	if len(got) != 2 || got[0] != "*.apps.cl.qzsyzn.com" || got[1] != "apps.cl.qzsyzn.com" {
		t.Fatalf("%v", got)
	}
}

func TestChallengeHost(t *testing.T) {
	if got := ChallengeHost("*.apps.cl.qzsyzn.com"); got != "_acme-challenge.apps.cl.qzsyzn.com" {
		t.Fatalf("%s", got)
	}
}

func TestSplitRecord(t *testing.T) {
	d, sub := SplitRecord("_acme-challenge.apps.cl.qzsyzn.com", "cl.qzsyzn.com")
	if d != "cl.qzsyzn.com" || sub != "_acme-challenge.apps" {
		t.Fatalf("%s %s", d, sub)
	}
	d, sub = SplitRecord("_acme-challenge.apps.cl.qzsyzn.com", "qzsyzn.com")
	if d != "qzsyzn.com" || sub != "_acme-challenge.apps.cl" {
		t.Fatalf("registered root: %s %s", d, sub)
	}
}

func TestSiteCoveredByCert(t *testing.T) {
	if !siteCoveredByCert("apps.cl.qzsyzn.com", []string{"*.apps.cl.qzsyzn.com", "apps.cl.qzsyzn.com"}) {
		t.Fatal("apps cert should cover apps site")
	}
	if siteCoveredByCert("apps.cl.qzsyzn.com", []string{"*.cl.qzsyzn.com", "cl.qzsyzn.com"}) {
		t.Fatal("cl wildcard must not deploy onto apps site")
	}
}

func TestNeedsRenewViaSelfSign(t *testing.T) {
	b, err := (SelfSignedIssuer{}).Issue(t.Context(), []string{"*.apps.example.com", "apps.example.com"})
	if err != nil || len(b.CertPEM) == 0 || len(b.KeyPEM) == 0 {
		t.Fatalf("%v %#v", err, b)
	}
	if b.NotAfter.Before(b.NotBefore) {
		t.Fatal(b.NotAfter)
	}
}
