import { FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useGetIdentity, useOne } from "@refinedev/core";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Clock,
  Cpu,
  Database,
  Globe,
  HardDrive,
  LayoutDashboard,
  ScrollText,
  Terminal,
  Copy,
  Info,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { api, friendlyError, isApiError, type AuthUser } from "@/providers";
import { canSSH, sshAccessLabel } from "@/lib/permissions";
import {
  formatCpuCores,
  formatDiskSize,
  formatMemSize,
  formatPlanSpec,
  hasPendingResize,
  pendingSpec,
  ProjectOption,
  statusLabel,
  Workspace,
  workspaceSpec,
  workspaceStatusDotClass,
  workspaceStatusVariant,
  workspaceDetailQueryPollInterval,
} from "./types";
import { ImportKeyDialog } from "./ImportKeyDialog";
import { WorkspaceTerminalDialog } from "./WorkspaceTerminalDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SelectBox } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PageFrame } from "@/components/ui/page-frame";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, Loading, useToast } from "@/ui";
import { copyText, formatTime } from "@/ui/format";
import { actionLabel } from "@/pages/ops/format";
import { Elevated } from "@/lib/elevated";
import { cn } from "@/lib/utils";
import { Hint } from "@/components/ui/tooltip";
import { useFluidHover, useRegisterFluidHoverItem } from "@/hooks/use-fluid-hover";
import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Section = "overview" | "connect" | "ingress" | "history";

const commandBoxClass =
  "mono min-w-0 flex-1 break-all rounded-lg border border-border/60 bg-(--token-box-bg) px-3 py-2.5 text-xs text-foreground select-all";

function ConnectCommandRow({
  label,
  command,
  copyTestId,
  commandTestId,
  onCopy,
}: {
  label: ReactNode;
  command: string;
  copyTestId?: string;
  commandTestId?: string;
  onCopy: () => void;
}) {
  return (
    <Field label={label}>
      <div className="flex min-w-0 items-stretch gap-2">
        <code className={commandBoxClass} data-testid={commandTestId}>
          {command}
        </code>
        <Button
          type="button"
          variant="outline"
          size="compact"
          data-testid={copyTestId}
          className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 self-stretch px-3"
          onClick={onCopy}
        >
          <Copy className="size-3.5 shrink-0 opacity-70" />
          复制
        </Button>
      </div>
    </Field>
  );
}

type ConnInfo = {
  command: string;
  scp_example?: string;
  host: string;
  port: number;
  user: string;
  workspace_id: string;
  note?: string;
};

type IngressRoute = {
  id: string;
  domain: string;
  path: string;
  port: number;
  preset: string;
  nginx_preview?: string;
  dns_hint?: string;
  status: string;
  reject_reason?: string;
};

type IngressMeta = {
  public_host: string;
  note?: string;
  presets: Array<{ id: string; label: string; description: string }>;
};

type WsAudit = {
  id: number;
  actor_username?: string;
  action: string;
  ip?: string;
  created_at: string;
  meta?: Record<string, unknown>;
};

function parseSection(pathname: string, id: string): Section {
  const base = `/workspaces/${id}`;
  if (pathname.startsWith(`${base}/ingress`)) return "ingress";
  if (pathname.startsWith(`${base}/history`)) return "history";
  if (pathname.startsWith(`${base}/connect`)) return "connect";
  return "overview";
}

function viaLabel(meta?: Record<string, unknown>): string {
  const via = typeof meta?.via === "string" ? meta.via : "";
  if (via === "web-terminal") return "网页终端";
  if (via === "bastion") return "SSH 跳板";
  return via;
}

function ingressStatusLabel(status: string): string {
  if (status === "active") return "已生效";
  if (status === "pending_approval") return "待审批";
  if (status === "rejected") return "已驳回";
  return status;
}

function ingressStatusVariant(status: string): "ok" | "warn" | "danger" | "outline" {
  if (status === "active") return "ok";
  if (status === "rejected") return "danger";
  if (status === "pending_approval") return "warn";
  return "outline";
}

function isConnectAction(action: string): boolean {
  return action.startsWith("ssh.");
}

interface NavTabItemProps {
  label: string;
  icon: typeof LayoutDashboard;
  isActive: boolean;
  onClick: () => void;
  index: number;
  testId: string;
  registerItem: (index: number, element: HTMLElement | null) => void;
}

function NavTabItem({ label, icon: Icon, isActive, onClick, index, testId, registerItem }: NavTabItemProps) {
  const ref = useRef<HTMLButtonElement>(null);
  useRegisterFluidHoverItem(registerItem, index, ref);

  return (
    <button
      ref={ref}
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "relative z-10 flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring whitespace-nowrap cursor-pointer select-none",
        isActive
          ? "bg-surface-2 text-foreground font-semibold shadow-xs"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
      <span>{label}</span>
    </button>
  );
}

export function MachinePage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: me } = useGetIdentity<AuthUser>();
  const { data, isLoading, isError, error } = useOne<Workspace>({
    resource: "workspaces",
    id,
    queryOptions: {
      refetchInterval: workspaceDetailQueryPollInterval,
    },
  });
  const ws = data?.data;
  const section = parseSection(location.pathname, id);

  const [projectCtx, setProjectCtx] = useState<ProjectOption | null>(null);
  const [conn, setConn] = useState<ConnInfo | null>(null);
  const [connErr, setConnErr] = useState("");
  const [routes, setRoutes] = useState<IngressRoute[]>([]);
  const [meta, setMeta] = useState<IngressMeta | null>(null);
  const [domain, setDomain] = useState("");
  const [port, setPort] = useState("8080");
  const [preset, setPreset] = useState("nocache");
  const [extraNginx, setExtraNginx] = useState("");
  const [showExtra, setShowExtra] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [secondOpen, setSecondOpen] = useState(false);
  const [ingressOpen, setIngressOpen] = useState(false);
  const [termOpen, setTermOpen] = useState(false);
  const [pendingBody, setPendingBody] = useState<Record<string, unknown> | null>(null);
  const [logs, setLogs] = useState<WsAudit[]>([]);
  const [logsErr, setLogsErr] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);

  const tabsRef = useRef<HTMLDivElement>(null);
  const tabsHover = useFluidHover(tabsRef, { axis: "x" });

  const loadConn = useCallback(async () => {
    if (!id) return;
    setConnErr("");
    try {
      setConn(await api<ConnInfo>(`/workspaces/${id}/connection`));
    } catch (e) {
      setConnErr(friendlyError(e));
      setConn(null);
    }
  }, [id]);

  const loadIngress = useCallback(async () => {
    if (!id) return;
    try {
      const json = await api<{ data: IngressRoute[] }>(`/workspaces/${id}/ingress`);
      setRoutes(json.data ?? []);
    } catch {
      setRoutes([]);
    }
  }, [id]);

  const loadHistory = useCallback(async () => {
    if (!id) return;
    setLogsErr("");
    setLogsLoading(true);
    try {
      const json = await api<{ data: WsAudit[] }>(`/workspaces/${id}/audit`);
      setLogs(json.data ?? []);
    } catch (e) {
      setLogsErr(friendlyError(e));
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!ws?.project_id) return;
    api<ProjectOption>(`/projects/${ws.project_id}`)
      .then(setProjectCtx)
      .catch(() => setProjectCtx(null));
  }, [ws?.project_id]);

  useEffect(() => {
    if (section !== "connect") return;
    void loadConn();
  }, [section, loadConn]);

  useEffect(() => {
    if (section !== "ingress" && section !== "overview") return;
    api<IngressMeta>("/ingress/meta")
      .then(setMeta)
      .catch(() => setMeta(null));
  }, [section]);

  useEffect(() => {
    if (section !== "history" && section !== "overview") return;
    void loadHistory();
  }, [section, loadHistory]);

  useEffect(() => {
    if (section !== "ingress" && section !== "overview") return;
    void loadIngress();
  }, [section, loadIngress]);

  async function copy(text: string, ok: string) {
    const copied = await copyText(text);
    if (copied) toast.show(ok, "success");
    else toast.show("复制失败，请手动选择命令", "error");
  }

  function resetIngressForm() {
    setDomain("");
    setPort("8080");
    setPreset("nocache");
    setExtraNginx("");
    setShowExtra(false);
    setFormErr("");
  }

  async function submitIngress(confirmSecond: boolean) {
    setFormErr("");
    setBusy(true);
    const body = {
      domain: domain.trim(),
      port: Number(port),
      preset,
      extra_nginx: extraNginx.trim(),
      confirm_second_port: confirmSecond,
    };
    try {
      await api(`/workspaces/${id}/ingress`, { method: "POST", body: JSON.stringify(body) });
      resetIngressForm();
      setIngressOpen(false);
      toast.show("已接入域名，请按提示修改 DNS", "success");
      await loadIngress();
    } catch (e) {
      if (isApiError(e) && e.message === "SECOND_PORT_CONFIRM_REQUIRED") {
        setPendingBody(body);
        setSecondOpen(true);
        return;
      }
      setFormErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function onIngress(e: FormEvent) {
    e.preventDefault();
    await submitIngress(false);
  }

  async function removeRoute(rid: string) {
    setBusy(true);
    try {
      await api(`/ingress/${rid}`, { method: "DELETE" });
      toast.show("已移除域名", "success");
      await loadIngress();
    } catch (e) {
      setFormErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function approveRoute(rid: string) {
    setBusy(true);
    try {
      await api(`/ingress/${rid}/approve`, { method: "POST" });
      toast.show("已批准域名", "success");
      await loadIngress();
    } catch (e) {
      toast.show(friendlyError(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function rejectRoute(rid: string) {
    const reason = window.prompt("请输入驳回原因（可选）：") ?? "";
    setBusy(true);
    try {
      await api(`/ingress/${rid}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
      toast.show("已驳回域名申请", "success");
      await loadIngress();
    } catch (e) {
      toast.show(friendlyError(e), "error");
    } finally {
      setBusy(false);
    }
  }

  const listHref = ws?.project_id
    ? `/workspaces?project_id=${encodeURIComponent(ws.project_id)}`
    : "/workspaces";

  const navTabs = useMemo(
    () => [
      { key: "overview" as const, label: "概览", icon: LayoutDashboard, route: `/workspaces/${id}`, testId: "ws-tab-overview" },
      { key: "connect" as const, label: "连接", icon: Terminal, route: `/workspaces/${id}/connect`, testId: "ws-tab-connect" },
      { key: "ingress" as const, label: "域名接入", icon: Globe, route: `/workspaces/${id}/ingress`, testId: "ws-tab-ingress" },
      { key: "history" as const, label: "操作历史", icon: ScrollText, route: `/workspaces/${id}/history`, testId: "ws-tab-history" },
    ],
    [id],
  );

  if (isLoading) {
    return <Loading label="加载机器…" />;
  }
  if (isError || !ws) {
    return (
      <section className="grid gap-3">
        <Alert variant="destructive">
          <AlertDescription>{friendlyError(error) || "找不到这台机器"}</AlertDescription>
        </Alert>
        <Button variant="link" asChild>
          <Link to="/workspaces">← 返回服务器</Link>
        </Button>
      </section>
    );
  }

  const spec = workspaceSpec(ws);
  const pending = pendingSpec(ws);
  const wsRunning = ws.status === "running" || ws.status === "fabric_degraded";
  const sshGranted = canSSH(projectCtx?.my_role, projectCtx?.my_ssh_access, me?.platform_role);
  const canConnect = wsRunning && sshGranted;
  const showSSHRequest = wsRunning && !sshGranted && projectCtx?.my_role === "developer";
  const recentLogs = logs.slice(0, 5);
  const activeRoutes = routes.filter((rt) => rt.status === "active");
  const pendingRoutes = routes.filter((rt) => rt.status === "pending_approval");

  return (
    <PageFrame
      header={
        <div className="grid gap-2">
          <div className="flex md:hidden items-center justify-between gap-2 text-xs text-muted-foreground">
            <Link
              to={listHref}
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors font-medium"
            >
              <ArrowLeft className="size-3.5" />
              <span>全部服务器</span>
            </Link>
          </div>
          <PageHeader
            title={ws.name}
            description="独立隔离主机 · 进程、磁盘与网络与其他机器互不互通"
          />
          <div
            ref={tabsRef}
            className="flex md:hidden relative items-center gap-1 overflow-x-auto pt-2 border-t border-border/60 scrollbar-none"
            data-testid="ws-mobile-tabs"
            {...tabsHover.handlers}
          >
            <FluidHoverHighlight hover={tabsHover} className="rounded-lg bg-hover" />
            {navTabs.map((tab, idx) => (
              <NavTabItem
                key={tab.key}
                index={idx}
                registerItem={tabsHover.registerItem}
                label={tab.label}
                icon={tab.icon}
                isActive={section === tab.key}
                testId={tab.testId}
                onClick={() => navigate(tab.route)}
              />
            ))}
          </div>
        </div>
      }
    >
      <div className="grid gap-6 pb-8">
        {section === "overview" && (
          <div className="grid gap-4">
            {ws.status === "fabric_degraded" && (
              <Alert variant="info">
                <AlertDescription className="inline-flex items-center gap-1.5">
                  <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
                  网络降级：Overlay 暂不可用，控制台仍可管理；SSH 与域名接入可能受影响。
                </AlertDescription>
              </Alert>
            )}
            {hasPendingResize(ws) && pending && spec && (
              <Alert variant="info">
                <AlertDescription>
                  规格变更审批中：{formatPlanSpec(spec)} → {formatPlanSpec(pending)}。
                  审批通过后将自动生效。
                </AlertDescription>
              </Alert>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="ws-overview-stats">
              <Elevated offset={1} shadowLevel={1} className="rounded-xl border border-border/80 p-3.5">
                <p className="m-0 text-xs font-medium text-muted-foreground">状态</p>
                <div className="mt-2 inline-flex items-center gap-2 whitespace-nowrap shrink-0">
                  <span className={cn("size-2 rounded-full shrink-0", workspaceStatusDotClass(ws.status))} />
                  <Hint label={ws.status} className="font-mono">
                    <Badge variant={workspaceStatusVariant(ws.status)}>{statusLabel(ws.status)}</Badge>
                  </Hint>
                </div>
              </Elevated>
              <Elevated offset={1} shadowLevel={1} className="rounded-xl border border-border/80 p-3.5">
                <p className="m-0 text-xs font-medium text-muted-foreground inline-flex items-center gap-1.5">
                  <Cpu className="size-3.5 shrink-0 opacity-70" />
                  规格
                </p>
                <p className="m-0 mt-2 text-sm font-medium whitespace-nowrap">
                  {spec ? formatPlanSpec(spec) : ws.plan}
                </p>
                <p className="m-0 mt-0.5 text-[11px] text-muted-foreground font-mono truncate">{ws.plan}</p>
              </Elevated>
              <Elevated offset={1} shadowLevel={1} className="rounded-xl border border-border/80 p-3.5">
                <p className="m-0 text-xs font-medium text-muted-foreground inline-flex items-center gap-1.5">
                  <HardDrive className="size-3.5 shrink-0 opacity-70" />
                  节点
                </p>
                <p className="m-0 mt-2 text-sm font-medium truncate">{ws.node_name || "—"}</p>
                {ws.arch && (
                  <p className="m-0 mt-0.5 text-[11px] text-muted-foreground font-mono whitespace-nowrap">{ws.arch}</p>
                )}
              </Elevated>
              <Elevated offset={1} shadowLevel={1} className="rounded-xl border border-border/80 p-3.5">
                <p className="m-0 text-xs font-medium text-muted-foreground inline-flex items-center gap-1.5">
                  <Clock className="size-3.5 shrink-0 opacity-70" />
                  创建时间
                </p>
                <p className="m-0 mt-2 text-sm font-medium whitespace-nowrap">{formatTime(ws.created_at)}</p>
              </Elevated>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {spec && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Activity className="size-4 text-primary shrink-0" />
                      资源配额
                    </CardTitle>
                    <CardDescription>当前分配的 CPU、内存与磁盘硬占用（停止后仍计入项目预算）。</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-lg border border-border/80 bg-surface-1/50 px-3 py-2.5">
                        <p className="m-0 text-[11px] text-muted-foreground inline-flex items-center gap-1 whitespace-nowrap">
                          <Cpu className="size-3 shrink-0 opacity-70" />
                          CPU
                        </p>
                        <p className="m-0 mt-1 text-sm font-semibold whitespace-nowrap">{formatCpuCores(spec.cpu_milli)}</p>
                      </div>
                      <div className="rounded-lg border border-border/80 bg-surface-1/50 px-3 py-2.5">
                        <p className="m-0 text-[11px] text-muted-foreground inline-flex items-center gap-1 whitespace-nowrap">
                          <Database className="size-3 shrink-0 opacity-70" />
                          内存
                        </p>
                        <p className="m-0 mt-1 text-sm font-semibold whitespace-nowrap">{formatMemSize(spec.mem_bytes)}</p>
                      </div>
                      <div className="rounded-lg border border-border/80 bg-surface-1/50 px-3 py-2.5">
                        <p className="m-0 text-[11px] text-muted-foreground inline-flex items-center gap-1 whitespace-nowrap">
                          <HardDrive className="size-3 shrink-0 opacity-70" />
                          磁盘
                        </p>
                        <p className="m-0 mt-1 text-sm font-semibold whitespace-nowrap">{formatDiskSize(spec.disk_bytes)}</p>
                      </div>
                    </div>
                    <p className="m-0 text-xs text-muted-foreground min-w-0 wrap-break-word">
                      实时 CPU / 内存曲线将在 agent 上报指标后展示。
                    </p>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Terminal className="size-4 text-primary shrink-0" />
                    连接
                  </CardTitle>
                  <CardDescription>
                    {canConnect
                      ? "有 SSH 权限，可直接打开网页终端或通过跳板连接。"
                      : wsRunning
                        ? "机器已运行，连接前需确认 SSH 权限。"
                        : "机器尚未运行，开通后才会给出连接信息。"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {!wsRunning && (
                    <p className="m-0 text-sm text-muted-foreground">当前状态：{statusLabel(ws.status)}。</p>
                  )}
                  {wsRunning && !sshGranted && (
                    <Alert variant="info">
                      <AlertDescription>
                        SSH 状态：{sshAccessLabel(projectCtx?.my_ssh_access)}。
                        {showSSHRequest && ws.project_id ? (
                          <>
                            {" "}
                            <Link className="underline" to={`/projects/${ws.project_id}/members`}>
                              前往成员页申请
                            </Link>
                          </>
                        ) : (
                          " 请联系项目管理员授权。"
                        )}
                      </AlertDescription>
                    </Alert>
                  )}
                  {canConnect && (
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" data-testid="ws-overview-terminal" onClick={() => setTermOpen(true)}>
                        <Terminal className="size-4 shrink-0" />
                        打开网页终端
                      </Button>
                      <Button type="button" variant="outline" onClick={() => navigate(`/workspaces/${id}/connect`)}>
                        SSH 命令
                        <ChevronRight className="size-3.5 shrink-0 opacity-60" />
                      </Button>
                      <WorkspaceTerminalDialog
                        workspaceId={ws.id}
                        workspaceName={ws.name}
                        open={termOpen}
                        onOpenChange={setTermOpen}
                      />
                    </div>
                  )}
                  {!canConnect && wsRunning && (
                    <Button type="button" variant="outline" onClick={() => navigate(`/workspaces/${id}/connect`)}>
                      查看连接说明
                      <ChevronRight className="size-3.5 shrink-0 opacity-60" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Globe className="size-4 text-primary shrink-0" />
                      域名接入
                    </CardTitle>
                    <Button
                      type="button"
                      variant="ghost"
                      size="compact"
                      className="h-7 px-2 text-xs shrink-0 whitespace-nowrap"
                      onClick={() => navigate(`/workspaces/${id}/ingress`)}
                    >
                      管理
                      <ChevronRight className="size-3.5 shrink-0 opacity-60" />
                    </Button>
                  </div>
                  <CardDescription>
                    {routes.length === 0
                      ? "尚未接入域名，可将服务暴露到公网。"
                      : `已配置 ${routes.length} 条规则${activeRoutes.length > 0 ? `，${activeRoutes.length} 条已生效` : ""}。`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-2">
                  {routes.length === 0 ? (
                    <Button type="button" variant="outline" className="w-fit" onClick={() => navigate(`/workspaces/${id}/ingress`)}>
                      <Globe className="size-4 shrink-0" />
                      接入域名
                    </Button>
                  ) : (
                    <>
                      {routes.slice(0, 3).map((rt) => (
                        <div
                          key={rt.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-border/80 px-3 py-2 min-w-0"
                        >
                          <span className="text-sm font-medium truncate min-w-0">{rt.domain}</span>
                          <Badge
                            variant={rt.status === "active" ? "ok" : rt.status === "rejected" ? "danger" : "warn"}
                            className="inline-flex items-center whitespace-nowrap shrink-0"
                          >
                            {rt.status === "active" ? "已生效" : rt.status === "pending_approval" ? "待审批" : rt.status === "rejected" ? "已驳回" : rt.status}
                          </Badge>
                        </div>
                      ))}
                      {pendingRoutes.length > 0 && (
                        <p className="m-0 text-xs text-muted-foreground">{pendingRoutes.length} 条规则待审批。</p>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ScrollText className="size-4 text-primary shrink-0" />
                      最近操作
                    </CardTitle>
                    <Button
                      type="button"
                      variant="ghost"
                      size="compact"
                      className="h-7 px-2 text-xs shrink-0 whitespace-nowrap"
                      onClick={() => navigate(`/workspaces/${id}/history`)}
                    >
                      全部
                      <ChevronRight className="size-3.5 shrink-0 opacity-60" />
                    </Button>
                  </div>
                  <CardDescription>扩容、域名、SSH 连接等操作记录。</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-2">
                  {logsLoading ? (
                    <Loading label="加载操作记录…" />
                  ) : recentLogs.length === 0 ? (
                    <p className="m-0 text-sm text-muted-foreground">还没有记录。连接或变更配置后会出现在这里。</p>
                  ) : (
                    recentLogs.map((row) => {
                      const via = viaLabel(row.meta);
                      return (
                        <div
                          key={row.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-border/80 px-3 py-2 min-w-0"
                          data-testid="ws-overview-audit-row"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <Badge
                                variant={isConnectAction(row.action) ? "ok" : "outline"}
                                className="inline-flex items-center whitespace-nowrap shrink-0"
                              >
                                {actionLabel(row.action)}
                              </Badge>
                              {row.actor_username && (
                                <span className="text-xs text-muted-foreground truncate">{row.actor_username}</span>
                              )}
                            </div>
                            {via && <p className="m-0 mt-0.5 text-[11px] text-muted-foreground truncate">{via}</p>}
                          </div>
                          <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">
                            {formatTime(row.created_at)}
                          </span>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {section === "connect" && (
          <Card>
            <CardHeader>
              <CardTitle>SSH 连接</CardTitle>
              <CardDescription>
                有权限时可直接在网页打开终端；也可以导入本机公钥后用本地 SSH / scp。
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {!wsRunning && <p className="m-0 text-sm text-muted-foreground">机器尚未运行，开通后才会给出连接信息。</p>}
              {wsRunning && !sshGranted && (
                <Alert variant="info">
                  <AlertDescription>
                    当前 SSH 状态：{sshAccessLabel(projectCtx?.my_ssh_access)}。
                    {showSSHRequest && ws.project_id ? (
                      <>
                        {" "}
                        <Link className="underline" to={`/projects/${ws.project_id}/members`}>前往成员页申请 SSH 连接权</Link>
                      </>
                    ) : (
                      " 请联系项目管理员授权。"
                    )}
                  </AlertDescription>
                </Alert>
              )}
              {connErr && (
                <Alert variant="destructive">
                  <AlertDescription>{connErr}</AlertDescription>
                </Alert>
              )}
              {canConnect && (
                <Elevated
                  offset={1}
                  shadowLevel={1}
                  className="rounded-xl border border-border/80 bg-surface-1 p-4 grid gap-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="m-0 text-sm font-medium text-foreground">网页终端</p>
                      <p className="m-0 mt-0.5 text-xs text-muted-foreground wrap-break-word min-w-0">
                        无需本机私钥，直接在浏览器打开 Shell。
                      </p>
                    </div>
                    <Button
                      type="button"
                      data-testid="ws-web-terminal"
                      className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                      onClick={() => setTermOpen(true)}
                    >
                      <Terminal className="size-4 shrink-0" />
                      打开网页终端
                    </Button>
                    <WorkspaceTerminalDialog
                      workspaceId={ws.id}
                      workspaceName={ws.name}
                      open={termOpen}
                      onOpenChange={setTermOpen}
                    />
                  </div>
                  {conn && (
                    <>
                      <div className="border-t border-border/60 pt-4 grid gap-4">
                        <ConnectCommandRow
                          label={
                            <span className="inline-flex items-center gap-1.5 shrink-0">
                              <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
                              SSH
                            </span>
                          }
                          command={conn.command}
                          commandTestId="ws-ssh-cmd"
                          copyTestId="ws-copy-ssh"
                          onCopy={() => void copy(conn.command, "已复制 SSH 命令")}
                        />
                        {conn.scp_example && (
                          <ConnectCommandRow
                            label={
                              <span className="inline-flex items-center gap-1.5 shrink-0">
                                <Upload className="size-3.5 shrink-0 text-muted-foreground" />
                                上传文件（scp）
                              </span>
                            }
                            command={conn.scp_example}
                            onCopy={() => void copy(conn.scp_example!, "已复制 scp 命令")}
                          />
                        )}
                      </div>
                      {conn.note && (
                        <p className="m-0 flex items-start gap-1.5 text-xs text-muted-foreground wrap-break-word min-w-0">
                          <Info className="size-3.5 shrink-0 mt-0.5 opacity-70" />
                          <span>{conn.note}</span>
                        </p>
                      )}
                    </>
                  )}
                </Elevated>
              )}
              <div className="flex flex-wrap gap-2 pt-1 border-t border-border/60">
                <ImportKeyDialog
                  trigger={
                    <Button type="button" data-testid="ws-import-key">
                      导入 SSH 公钥
                    </Button>
                  }
                  onImported={() => toast.show("公钥已导入，可用该密钥连接跳板", "success")}
                />
                <Button variant="outline" asChild>
                  <Link to="/settings/keys">管理全部公钥</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {section === "ingress" && (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <CardTitle className="inline-flex items-center gap-2">
                    <Globe className="size-4 shrink-0 text-primary" />
                    域名接入
                  </CardTitle>
                  <CardDescription className="mt-1.5">
                    {meta?.note ||
                      "把你的域名 A 记录指到平台公网入口，我们按 Host 分流到这台隔离主机。默认每台机器只暴露一个服务端口。"}
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  data-testid="ing-add"
                  disabled={!canConnect}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  onClick={() => setIngressOpen(true)}
                >
                  <Plus className="size-4 shrink-0" />
                  接入域名
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4">
              {meta && (
                <Alert>
                  <AlertDescription className="break-words min-w-0">
                    公网入口：<span className="font-mono">{meta.public_host}</span>
                    。在域名服务商添加 <span className="font-mono">A → {meta.public_host}</span>。
                  </AlertDescription>
                </Alert>
              )}
              {routes.length === 0 ? (
                <p className="m-0 text-sm text-muted-foreground">还没有接入域名。点击「接入域名」添加第一条规则。</p>
              ) : (
                <div className="w-full overflow-x-auto rounded-xl border border-border/80">
                  <Table data-testid="ing-table" className="min-w-[640px]">
                    <TableHeader className="sticky top-0 z-10 bg-surface-2/80 backdrop-blur-xs">
                      <TableRow>
                        <TableHead className="min-w-0">域名</TableHead>
                        <TableHead className="w-[90px] whitespace-nowrap">端口</TableHead>
                        <TableHead className="w-[120px] whitespace-nowrap">预设</TableHead>
                        <TableHead className="w-[110px] whitespace-nowrap">状态</TableHead>
                        <TableHead className="w-[180px] whitespace-nowrap text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {routes.map((rt) => {
                        const presetLabel =
                          meta?.presets?.find((p) => p.id === rt.preset)?.label ?? rt.preset;
                        return (
                          <TableRow key={rt.id} data-testid="ing-row">
                            <TableCell className="min-w-0 max-w-[280px]">
                              <div className="grid min-w-0 gap-1">
                                <Hint label={rt.domain} className="font-medium truncate block">
                                  {rt.domain}
                                </Hint>
                                {rt.dns_hint && (
                                  <p className="m-0 text-xs text-muted-foreground truncate">{rt.dns_hint}</p>
                                )}
                                {rt.reject_reason && (
                                  <p className="m-0 text-xs text-destructive break-words min-w-0">
                                    驳回原因：{rt.reject_reason}
                                  </p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="whitespace-nowrap font-mono text-sm">:{rt.port}</TableCell>
                            <TableCell className="whitespace-nowrap text-sm">
                              <Hint label={rt.preset} className="font-mono text-xs">
                                {presetLabel}
                              </Hint>
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              <Badge
                                variant={ingressStatusVariant(rt.status)}
                                className="inline-flex items-center whitespace-nowrap shrink-0"
                              >
                                <Hint label={rt.status}>{ingressStatusLabel(rt.status)}</Hint>
                              </Badge>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right">
                              <div className="inline-flex items-center justify-end gap-1 shrink-0">
                                {rt.status === "pending_approval" && (
                                  <>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="compact"
                                      className="inline-flex items-center whitespace-nowrap shrink-0"
                                      onClick={() => void approveRoute(rt.id)}
                                    >
                                      批准
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="compact"
                                      className="inline-flex items-center whitespace-nowrap shrink-0"
                                      onClick={() => void rejectRoute(rt.id)}
                                    >
                                      驳回
                                    </Button>
                                  </>
                                )}
                                <Hint label="移除域名">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="compact"
                                    className="inline-flex size-7 items-center justify-center p-0 shrink-0"
                                    onClick={() => void removeRoute(rt.id)}
                                  >
                                    <Trash2 className="size-3.5 shrink-0" />
                                  </Button>
                                </Hint>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {section === "history" && (
          <Card>
            <CardHeader>
              <CardTitle>操作历史</CardTitle>
              <CardDescription>
                谁用网页终端或 SSH 连过这台机器，以及扩容、域名、启停等操作都会记在这里。
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {logsErr && (
                <Alert variant="destructive">
                  <AlertDescription>{logsErr}</AlertDescription>
                </Alert>
              )}
              {logsLoading ? (
                <Loading label="加载操作历史…" />
              ) : logs.length === 0 ? (
                <p className="m-0 text-sm text-muted-foreground">还没有记录。打开网页终端、通过跳板 SSH，或做扩容 / 域名接入后会出现在这里。</p>
              ) : (
                <div className="w-full overflow-x-auto rounded-xl border border-border/80">
                  <Table data-testid="ws-audit-table" className="min-w-160">
                    <TableHeader>
                      <TableRow>
                        <TableHead>时间</TableHead>
                        <TableHead>操作人</TableHead>
                        <TableHead>动作</TableHead>
                        <TableHead>来源</TableHead>
                        <TableHead>IP</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map((row) => {
                        const via = viaLabel(row.meta);
                        return (
                          <TableRow key={row.id} data-testid="ws-audit-row">
                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                              {formatTime(row.created_at)}
                            </TableCell>
                            <TableCell className="font-medium">{row.actor_username || "—"}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                <Badge variant={isConnectAction(row.action) ? "ok" : "outline"}>
                                  {actionLabel(row.action)}
                                </Badge>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{via || "—"}</TableCell>
                            <TableCell className="font-mono text-xs">{row.ip || "—"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog
        open={ingressOpen}
        onOpenChange={(open) => {
          setIngressOpen(open);
          if (!open) resetIngressForm();
        }}
      >
        <DialogContent size="lg" className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>接入域名</DialogTitle>
            <DialogDescription className="break-words min-w-0">
              {meta
                ? `将域名 A 记录指向 ${meta.public_host}，平台按 Host 头转发到这台主机内的服务端口。`
                : "将域名 A 记录指向平台公网入口，平台按 Host 头转发到这台主机内的服务端口。"}
            </DialogDescription>
          </DialogHeader>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={(e) => void onIngress(e)}>
            <DialogBody className="grid gap-4 overflow-x-hidden overflow-y-auto max-w-full">
              <Field label="你的域名">
                <Input
                  data-testid="ing-domain"
                  placeholder="app.example.com"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  required
                />
              </Field>
              <Field label="主机内服务端口">
                <Input
                  data-testid="ing-port"
                  inputMode="numeric"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  required
                />
              </Field>
              <Field label="反代预设">
                <SelectBox
                  testId="ing-preset"
                  value={preset}
                  onValueChange={setPreset}
                  options={(meta?.presets ?? [{ id: "nocache", label: "无缓存（默认）" }]).map((p) => ({
                    value: p.id,
                    label: p.label,
                  }))}
                />
              </Field>
              {meta?.presets && (
                <p className="m-0 text-xs text-muted-foreground break-words min-w-0">
                  {meta.presets.find((p) => p.id === preset)?.description ||
                    "默认「无缓存」：关闭缓存与缓冲，超时 3600s。"}
                </p>
              )}
              <Button
                type="button"
                variant="ghost"
                className="h-auto w-fit px-0 text-sm"
                onClick={() => setShowExtra((v) => !v)}
              >
                {showExtra ? "收起自定义反代指令" : "自定义反代指令（可选）"}
              </Button>
              {showExtra && (
                <Field label="追加到 location 内的 nginx 指令">
                  <Textarea
                    data-testid="ing-extra"
                    rows={4}
                    placeholder={"proxy_set_header X-Foo bar;\nadd_header X-Bar baz;"}
                    value={extraNginx}
                    onChange={(e) => setExtraNginx(e.target.value)}
                  />
                </Field>
              )}
              {formErr && (
                <Alert variant="destructive">
                  <AlertDescription className="break-words min-w-0">{formErr}</AlertDescription>
                </Alert>
              )}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIngressOpen(false)}>
                取消
              </Button>
              <Button data-testid="ing-submit" disabled={busy || !canConnect} type="submit">
                {busy ? "提交中…" : "接入域名"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={secondOpen} onOpenChange={setSecondOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>再开第二个端口？</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <AlertDialogDescription>
              这台机器已经接过一个服务端口。多站点请在主机内用 nginx 按路径路由，而不是再暴露第二个端口。若你确认仍要第二个端口，我们会继续创建这条域名规则。
            </AlertDialogDescription>
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="ing-second-cancel">取消</AlertDialogCancel>
            <AlertDialogAction
              data-testid="ing-second-ok"
              onClick={() => {
                setSecondOpen(false);
                if (pendingBody) {
                  void submitIngress(true);
                }
              }}
            >
              确认使用第二端口
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageFrame>
  );
}
