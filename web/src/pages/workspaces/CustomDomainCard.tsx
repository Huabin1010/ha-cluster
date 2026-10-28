import { AlertTriangle, CheckCircle2, Clock, Copy, ExternalLink, Globe, Lock, RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import { formatTime } from "@/ui/format";
import {
  customDomainPhase,
  customDomainPhaseLabel,
  customDomainPhaseVariant,
  customDomainURL,
  dnsCodeHint,
  type CustomDomainRoute,
} from "@/lib/custom-domain";

export type CustomDomainCardRoute = CustomDomainRoute & {
  id: string;
  domain: string;
  port: number;
  dns_checked_at?: string;
  tls_error?: string;
  cname_target?: string;
  record_host?: string;
  record_zone?: string;
};

function RecordCell({
  label,
  value,
  testId,
  onCopy,
}: {
  label: string;
  value: string;
  testId?: string;
  onCopy?: () => void;
}) {
  return (
    <div className="grid min-w-0 gap-1">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5">
        <code className="mono min-w-0 flex-1 truncate rounded-md border border-border/60 bg-surface-1 px-2 py-1 text-[13px] text-foreground select-all">
          {value}
        </code>
        {onCopy && (
          <Hint label={`复制${label}`}>
            <Button
              type="button"
              variant="outline"
              size="compact"
              data-testid={testId}
              aria-label={`复制${label}`}
              className="inline-flex size-7 items-center justify-center p-0 shrink-0"
              onClick={onCopy}
            >
              <Copy className="size-3.5 shrink-0" />
            </Button>
          </Hint>
        )}
      </div>
    </div>
  );
}

/** One user-owned domain: the CNAME record to add, live status, and a re-check button. */
export function CustomDomainCard({
  route,
  busy,
  onCopy,
  onVerify,
}: {
  route: CustomDomainCardRoute;
  busy: boolean;
  onCopy: (text: string, ok: string) => void;
  onVerify: (id: string) => void;
}) {
  const phase = customDomainPhase(route);
  const live = phase === "live_https" || phase === "live_http";
  const host = route.record_host || "@";
  const target = route.cname_target || "";
  const codeHint = route.status === "pending_dns" || route.dns_error ? dnsCodeHint(route.dns_code) : "";
  const PhaseIcon = live ? CheckCircle2 : customDomainPhaseVariant(phase) === "danger" ? AlertTriangle : Clock;

  return (
    <div
      className="rounded-xl border border-border/80 bg-surface-2/40 p-3.5"
      data-testid="ws-domain-cname-card"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Globe className="size-4 shrink-0 text-muted-foreground opacity-70" />
          <span className="truncate text-sm font-medium text-foreground">{route.domain}</span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">→ :{route.port}</span>
        </span>
        <div className="inline-flex items-center gap-1.5 shrink-0">
          <Hint label={`${route.status} · tls=${route.tls_status || "none"}`} className="font-mono">
            <Badge
              variant={customDomainPhaseVariant(phase)}
              data-testid="ws-domain-status"
              className="inline-flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              <PhaseIcon className="size-3 shrink-0" />
              {customDomainPhaseLabel(phase)}
            </Badge>
          </Hint>
          {live && (
            <Button
              type="button"
              variant="outline"
              size="compact"
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              onClick={() => window.open(customDomainURL(route.domain, phase), "_blank", "noopener")}
            >
              {phase === "live_https" ? (
                <Lock className="size-3.5 shrink-0" />
              ) : (
                <ExternalLink className="size-3.5 shrink-0" />
              )}
              打开
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="compact"
            data-testid="ws-domain-verify"
            disabled={busy}
            className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            onClick={() => onVerify(route.id)}
          >
            <RotateCw className="size-3.5 shrink-0" />
            立即检测
          </Button>
        </div>
      </div>

      {target ? (
        <>
          <p className="m-0 mt-3 text-xs text-muted-foreground break-words min-w-0">
            {live
              ? "以下解析记录请保持不变，删除后域名将无法访问："
              : `在 ${route.record_zone || "你的域名"} 的 DNS 服务商（如 DNSPod、阿里云、Cloudflare）添加这条记录：`}
          </p>
          <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_80px_minmax(0,2fr)]">
            <RecordCell
              label="主机记录"
              value={host}
              testId="ws-domain-cname-copy-host"
              onCopy={() => onCopy(host, "已复制主机记录")}
            />
            <RecordCell label="记录类型" value="CNAME" />
            <RecordCell
              label="记录值"
              value={target}
              testId="ws-domain-cname-copy"
              onCopy={() => onCopy(target, "已复制记录值")}
            />
          </div>
        </>
      ) : (
        <p className="m-0 mt-3 text-xs text-destructive break-words min-w-0">
          平台尚未配置 CNAME 入口，请联系平台管理员。
        </p>
      )}

      {(codeHint || route.dns_error || route.tls_error) && (
        <div className="mt-3 grid gap-1">
          {codeHint && <p className="m-0 text-xs text-foreground break-words min-w-0">{codeHint}</p>}
          {route.dns_error && (
            <p className="m-0 text-xs text-muted-foreground break-words min-w-0">检测结果：{route.dns_error}</p>
          )}
          {phase === "cert_failed" && route.tls_error && (
            <p className="m-0 text-xs text-destructive break-words min-w-0">
              证书签发失败：{route.tls_error}。点「立即检测」重试，HTTP 访问不受影响。
            </p>
          )}
        </div>
      )}

      <p className="m-0 mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Clock className="size-3 shrink-0 opacity-60" />
        {route.dns_checked_at ? `上次检测 ${formatTime(route.dns_checked_at)}` : "尚未检测"}
        {route.status === "pending_dns" ? " · 平台会自动检测，通过后立即生效，无需审批" : ""}
      </p>
    </div>
  );
}
