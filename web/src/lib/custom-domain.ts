// Pure helpers for user-owned domains bound via CNAME.
// Kept in sync with internal/ingress/cname.go (suffix table, result codes).

const MULTI_LABEL_SUFFIXES = new Set([
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "ac.cn",
  "co.uk", "org.uk", "com.hk", "com.tw", "co.jp", "com.au", "co.kr", "com.sg",
]);

const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeDomain(d: string): string {
  return d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
}

/** Registrable root (example.com / example.com.cn) where DNS providers forbid CNAME. */
export function isApexDomain(d: string): boolean {
  const parts = normalizeDomain(d).split(".");
  if (parts.length < 2) return false;
  if (parts.length === 2) return true;
  if (parts.length === 3) return MULTI_LABEL_SUFFIXES.has(`${parts[1]}.${parts[2]}`);
  return false;
}

/** app.customer.com → { host: "app", zone: "customer.com" }, as typed into DNS consoles. */
export function splitRecordHost(d: string): { host: string; zone: string } {
  const norm = normalizeDomain(d);
  const parts = norm.split(".");
  let n = 2;
  if (parts.length >= 3 && MULTI_LABEL_SUFFIXES.has(parts.slice(-2).join("."))) n = 3;
  if (parts.length <= n) return { host: "@", zone: norm };
  return { host: parts.slice(0, parts.length - n).join("."), zone: parts.slice(-n).join(".") };
}

/** Returns a Chinese error message, or "" when the domain looks bindable. */
export function validateCustomDomain(d: string, platformBase?: string): string {
  const norm = normalizeDomain(d);
  if (!norm) return "请填写域名";
  if (norm.length > 253) return "域名过长";
  if (norm.startsWith("*.")) return "暂不支持泛域名，请填写具体子域，如 app.example.com";
  const parts = norm.split(".");
  if (parts.length < 2 || parts.some((p) => !LABEL_RE.test(p))) {
    return "域名格式不正确，只能包含字母、数字、连字符和点";
  }
  if (isApexDomain(norm)) {
    return "根域名无法设置 CNAME，请改用子域，如 app." + norm;
  }
  const base = platformBase ? normalizeDomain(platformBase) : "";
  if (base && (norm === base || norm.endsWith("." + base))) {
    return "这是平台自己的域名，请填写你自己的域名";
  }
  return "";
}

export type CustomDomainRoute = {
  status: string;
  verify_kind?: string;
  dns_code?: string;
  dns_error?: string;
  tls_status?: string;
};

export type CustomDomainPhase =
  | "waiting_dns"
  | "dns_error"
  | "issuing_cert"
  | "live_https"
  | "live_http"
  | "cert_failed"
  | "dns_lost";

export function isCustomDomainRoute(r: { verify_kind?: string }): boolean {
  return r.verify_kind === "cname";
}

export function customDomainPhase(r: CustomDomainRoute): CustomDomainPhase {
  if (r.status === "pending_dns") {
    return r.dns_code && r.dns_code !== "not_found" ? "dns_error" : "waiting_dns";
  }
  if (r.dns_error) return "dns_lost";
  switch (r.tls_status) {
    case "issued":
      return "live_https";
    case "pending":
      return "issuing_cert";
    case "failed":
      return "cert_failed";
    default:
      return "live_http";
  }
}

const PHASE_LABEL: Record<CustomDomainPhase, string> = {
  waiting_dns: "等待解析",
  dns_error: "解析异常",
  issuing_cert: "证书签发中",
  live_https: "已生效（HTTPS）",
  live_http: "已生效",
  cert_failed: "证书失败",
  dns_lost: "解析已失效",
};

export function customDomainPhaseLabel(p: CustomDomainPhase): string {
  return PHASE_LABEL[p];
}

export function customDomainPhaseVariant(p: CustomDomainPhase): "ok" | "warn" | "danger" {
  if (p === "live_https" || p === "live_http") return "ok";
  if (p === "dns_error" || p === "cert_failed" || p === "dns_lost") return "danger";
  return "warn";
}

/** Phases where the page should poll for progress. */
export function customDomainShouldPoll(p: CustomDomainPhase): boolean {
  return p === "waiting_dns" || p === "dns_error" || p === "issuing_cert";
}

/** Friendly advice for a verifier result code. */
export function dnsCodeHint(code?: string): string {
  switch (code) {
    case "not_found":
      return "还没查到这条记录。刚添加的记录通常 1–10 分钟生效，平台会自动重试。";
    case "wrong_target":
      return "记录值不对，请把 CNAME 改为上面给出的记录值。";
    case "proxied":
      return "域名开启了 CDN 代理（如 Cloudflare 橙色云朵），请改为「仅 DNS」后再检测。";
    case "apex":
      return "根域名不能设置 CNAME，请改用子域。";
    case "lookup_error":
      return "DNS 查询超时，稍后会自动重试。";
    case "no_target":
      return "平台尚未配置 CNAME 入口，请联系平台管理员。";
    default:
      return "";
  }
}

/** Public URL to open once live. */
export function customDomainURL(domain: string, p: CustomDomainPhase): string {
  return `${p === "live_https" ? "https" : "http"}://${normalizeDomain(domain)}`;
}

/**
 * URL of a route the user can open or copy. Empty when the site is not reachable yet
 * (pending approval, waiting on DNS, rejected). Platform subdomains use HTTPS;
 * a user-owned domain follows its certificate phase.
 */
export function publicSiteURL(domain: string, r: CustomDomainRoute): string {
  const host = normalizeDomain(domain);
  if (!host) return "";
  if (isCustomDomainRoute(r)) {
    const phase = customDomainPhase(r);
    if (phase !== "live_https" && phase !== "live_http") return "";
    return customDomainURL(host, phase);
  }
  if (r.status !== "active") return "";
  return `https://${host}`;
}
