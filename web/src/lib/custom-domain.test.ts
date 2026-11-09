import { describe, expect, it } from "vitest";
import {
  customDomainPhase,
  customDomainPhaseLabel,
  customDomainPhaseVariant,
  customDomainShouldPoll,
  customDomainURL,
  dnsCodeHint,
  publicSiteURL,
  isApexDomain,
  isCustomDomainRoute,
  normalizeDomain,
  splitRecordHost,
  validateCustomDomain,
} from "./custom-domain";

describe("normalizeDomain", () => {
  it("strips scheme, path, case and trailing dot", () => {
    expect(normalizeDomain("  HTTPS://App.Example.COM./x?y ")).toBe("app.example.com");
  });
});

describe("isApexDomain", () => {
  it.each([
    ["example.com", true],
    ["example.com.cn", true],
    ["app.example.com", false],
    ["a.b.example.com.cn", false],
    ["app.example.cn", false],
    ["localhost", false],
  ])("%s → %s", (d, want) => {
    expect(isApexDomain(d)).toBe(want);
  });
});

describe("splitRecordHost", () => {
  it.each([
    ["app.customer.com", "app", "customer.com"],
    ["a.b.customer.com", "a.b", "customer.com"],
    ["app.customer.com.cn", "app", "customer.com.cn"],
    ["customer.com", "@", "customer.com"],
    ["APP.Customer.com.", "app", "customer.com"],
  ])("%s", (d, host, zone) => {
    expect(splitRecordHost(d)).toEqual({ host, zone });
  });
});

describe("validateCustomDomain", () => {
  it("accepts a normal subdomain", () => {
    expect(validateCustomDomain("app.customer.com", "edge.cl.qzsyzn.com")).toBe("");
  });
  it("rejects empty, malformed, wildcard and apex", () => {
    expect(validateCustomDomain("  ")).toMatch("请填写");
    expect(validateCustomDomain("bad_domain.com")).toMatch("格式");
    expect(validateCustomDomain("-a.example.com")).toMatch("格式");
    expect(validateCustomDomain("*.example.com")).toMatch("泛域名");
    expect(validateCustomDomain("customer.com")).toMatch("app.customer.com");
  });
  it("rejects the platform base and its subdomains", () => {
    expect(validateCustomDomain("edge.cl.qzsyzn.com", "edge.cl.qzsyzn.com")).toMatch("平台");
    expect(validateCustomDomain("r-1.edge.cl.qzsyzn.com", "edge.cl.qzsyzn.com")).toMatch("平台");
  });
});

describe("customDomainPhase", () => {
  it("maps route state to user phases", () => {
    expect(customDomainPhase({ status: "pending_dns" })).toBe("waiting_dns");
    expect(customDomainPhase({ status: "pending_dns", dns_code: "not_found" })).toBe("waiting_dns");
    expect(customDomainPhase({ status: "pending_dns", dns_code: "wrong_target" })).toBe("dns_error");
    expect(customDomainPhase({ status: "active", tls_status: "pending" })).toBe("issuing_cert");
    expect(customDomainPhase({ status: "active", tls_status: "issued" })).toBe("live_https");
    expect(customDomainPhase({ status: "active", tls_status: "skipped" })).toBe("live_http");
    expect(customDomainPhase({ status: "active", tls_status: "failed" })).toBe("cert_failed");
    expect(customDomainPhase({ status: "active", tls_status: "issued", dns_error: "gone" })).toBe("dns_lost");
  });

  it("labels, variants and polling", () => {
    expect(customDomainPhaseLabel("waiting_dns")).toBe("等待解析");
    expect(customDomainPhaseLabel("live_https")).toContain("HTTPS");
    expect(customDomainPhaseVariant("live_https")).toBe("ok");
    expect(customDomainPhaseVariant("waiting_dns")).toBe("warn");
    expect(customDomainPhaseVariant("cert_failed")).toBe("danger");
    expect(customDomainPhaseVariant("dns_lost")).toBe("danger");
    expect(customDomainShouldPoll("waiting_dns")).toBe(true);
    expect(customDomainShouldPoll("issuing_cert")).toBe(true);
    expect(customDomainShouldPoll("live_https")).toBe(false);
  });
});

describe("misc", () => {
  it("detects cname routes", () => {
    expect(isCustomDomainRoute({ verify_kind: "cname" })).toBe(true);
    expect(isCustomDomainRoute({ verify_kind: "none" })).toBe(false);
    expect(isCustomDomainRoute({})).toBe(false);
  });
  it("gives hints for every known code", () => {
    for (const c of ["not_found", "wrong_target", "proxied", "apex", "lookup_error", "no_target"]) {
      expect(dnsCodeHint(c)).not.toBe("");
    }
    expect(dnsCodeHint("ok")).toBe("");
    expect(dnsCodeHint(undefined)).toBe("");
  });
  it("builds the open URL", () => {
    expect(customDomainURL("App.X.com", "live_https")).toBe("https://app.x.com");
    expect(customDomainURL("app.x.com", "live_http")).toBe("http://app.x.com");
  });
  it("only exposes a public URL once the site can be opened", () => {
    expect(publicSiteURL("Gold.Apps.Example.com", { status: "active" })).toBe("https://gold.apps.example.com");
    expect(publicSiteURL("gold.apps.example.com", { status: "pending_approval" })).toBe("");
    expect(publicSiteURL("app.customer.com", { status: "active", verify_kind: "cname", tls_status: "issued" })).toBe(
      "https://app.customer.com",
    );
    expect(publicSiteURL("app.customer.com", { status: "active", verify_kind: "cname", tls_status: "skipped" })).toBe(
      "http://app.customer.com",
    );
    expect(publicSiteURL("app.customer.com", { status: "pending_dns", verify_kind: "cname" })).toBe("");
    expect(publicSiteURL("  ", { status: "active" })).toBe("");
  });
});
