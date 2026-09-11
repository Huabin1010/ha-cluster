import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useGetIdentity, useOne } from "@refinedev/core";
import {
  ArrowLeft,
  Globe,
  LayoutDashboard,
  ScrollText,
  Server,
  Terminal,
} from "lucide-react";
import { api, friendlyError, isApiError, type AuthUser } from "@/providers";
import { canSSH, sshAccessLabel } from "@/lib/permissions";
import {
  formatPlanSpec,
  ProjectOption,
  statusLabel,
  Workspace,
  workspaceSpec,
  workspaceStatusVariant,
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
import { cn } from "@/lib/utils";
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

type Section = "overview" | "connect" | "ingress" | "history";

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

function isConnectAction(action: string): boolean {
  return action.startsWith("ssh.");
}

interface NavTabItemProps {
  label: string;
  icon: typeof LayoutDashboard;
  isActive: boolean;
  onClick: () => void;
  index: number;
  registerItem: (index: number, element: HTMLElement | null) => void;
}

function NavTabItem({ label, icon: Icon, isActive, onClick, index, registerItem }: NavTabItemProps) {
  const ref = useRef<HTMLButtonElement>(null);
  useRegisterFluidHoverItem(registerItem, index, ref);

  return (
    <button
      ref={ref}
      type="button"
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
  const { data, isLoading, isError, error } = useOne<Workspace>({ resource: "workspaces", id });
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
    if (section !== "ingress") return;
    void loadIngress();
    api<IngressMeta>("/ingress/meta")
      .then(setMeta)
      .catch(() => setMeta(null));
  }, [section, loadIngress]);

  useEffect(() => {
    if (section !== "history") return;
    void loadHistory();
  }, [section, loadHistory]);

  async function copy(text: string, ok: string) {
    const copied = await copyText(text);
    if (copied) toast.show(ok, "success");
    else toast.show("复制失败，请手动选择命令", "error");
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
      setDomain("");
      setExtraNginx("");
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
      { key: "overview" as const, label: "概览", icon: LayoutDashboard, route: `/workspaces/${id}` },
      { key: "connect" as const, label: "连接", icon: Terminal, route: `/workspaces/${id}/connect` },
      { key: "ingress" as const, label: "域名接入", icon: Globe, route: `/workspaces/${id}/ingress` },
      { key: "history" as const, label: "操作历史", icon: ScrollText, route: `/workspaces/${id}/history` },
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
  const wsRunning = ws.status === "running" || ws.status === "fabric_degraded";
  const sshGranted = canSSH(projectCtx?.my_role, projectCtx?.my_ssh_access, me?.platform_role);
  const canConnect = wsRunning && sshGranted;
  const showSSHRequest = wsRunning && !sshGranted && projectCtx?.my_role === "developer";

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
            description={
              spec
                ? `${ws.plan} · ${formatPlanSpec(spec)} · 独立隔离主机（即便与别的机器在同一物理节点上，进程/磁盘/网络也不互通）`
                : `${ws.plan} · 独立隔离主机`
            }
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
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>状态</CardDescription>
                  <CardTitle className="text-base">
                    <Badge variant={workspaceStatusVariant(ws.status)}>{statusLabel(ws.status)}</Badge>
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>规格</CardDescription>
                  <CardTitle className="text-base font-medium">
                    {spec ? formatPlanSpec(spec) : ws.plan}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>节点</CardDescription>
                  <CardTitle className="text-base font-medium">{ws.node_name || "—"}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>创建时间</CardDescription>
                  <CardTitle className="text-base font-medium">{formatTime(ws.created_at)}</CardTitle>
                </CardHeader>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server className="size-4 text-primary" />
                  快捷操作
                </CardTitle>
                <CardDescription>SSH / 网页终端、域名接入和谁连过这台机器，都在左侧菜单里。</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => navigate(`/workspaces/${id}/connect`)}>
                  <Terminal className="size-4" />
                  连接
                </Button>
                <Button type="button" variant="outline" onClick={() => navigate(`/workspaces/${id}/ingress`)}>
                  <Globe className="size-4" />
                  域名接入
                </Button>
                <Button type="button" variant="outline" onClick={() => navigate(`/workspaces/${id}/history`)}>
                  <ScrollText className="size-4" />
                  操作历史
                </Button>
              </CardContent>
            </Card>
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
                <div>
                  <Button type="button" data-testid="ws-web-terminal" onClick={() => setTermOpen(true)}>
                    <Terminal className="size-4" />
                    打开网页终端
                  </Button>
                  <WorkspaceTerminalDialog
                    workspaceId={ws.id}
                    workspaceName={ws.name}
                    open={termOpen}
                    onOpenChange={setTermOpen}
                  />
                </div>
              )}
              {conn && canConnect && (
                <>
                  <Field label="SSH">
                    <div className="flex flex-wrap gap-2">
                      <code className="mono min-w-0 flex-1 break-all rounded-md border border-border bg-muted px-2 py-2 text-xs" data-testid="ws-ssh-cmd">
                        {conn.command}
                      </code>
                      <Button type="button" data-testid="ws-copy-ssh" onClick={() => void copy(conn.command, "已复制 SSH 命令")}>
                        复制连接
                      </Button>
                    </div>
                  </Field>
                  {conn.scp_example && (
                    <Field label="上传文件（scp）">
                      <div className="flex flex-wrap gap-2">
                        <code className="mono min-w-0 flex-1 break-all rounded-md border border-border bg-muted px-2 py-2 text-xs">{conn.scp_example}</code>
                        <Button type="button" variant="outline" onClick={() => void copy(conn.scp_example!, "已复制 scp 命令")}>
                          复制
                        </Button>
                      </div>
                    </Field>
                  )}
                  {conn.note && <p className="m-0 text-sm text-muted-foreground">{conn.note}</p>}
                </>
              )}
              <div className="flex flex-wrap gap-2">
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
              <CardTitle>域名接入</CardTitle>
              <CardDescription>
                {meta?.note || "把你的域名 A 记录指到平台公网入口，我们按 Host 分流到这台隔离主机。默认每台机器只暴露一个服务端口。"}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {meta && (
                <Alert>
                  <AlertDescription>
                    公网入口：<span className="font-mono">{meta.public_host}</span>
                    。在域名服务商添加 <span className="font-mono">A → {meta.public_host}</span>。
                  </AlertDescription>
                </Alert>
              )}
              <form className="grid gap-3" onSubmit={(e) => void onIngress(e)}>
                <Field label="你的域名">
                  <Input data-testid="ing-domain" placeholder="app.example.com" value={domain} onChange={(e) => setDomain(e.target.value)} required />
                </Field>
                <Field label="主机内服务端口">
                  <Input data-testid="ing-port" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} required />
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
                  <p className="m-0 text-xs text-muted-foreground">
                    {meta.presets.find((p) => p.id === preset)?.description ||
                      "默认「无缓存」：关闭缓存与缓冲，超时 3600s。"}
                  </p>
                )}
                <Button type="button" variant="ghost" className="h-auto w-fit px-0 text-sm" onClick={() => setShowExtra((v) => !v)}>
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
                    <AlertDescription>{formErr}</AlertDescription>
                  </Alert>
                )}
                <Button data-testid="ing-submit" disabled={busy || !canConnect} type="submit">
                  {busy ? "提交中…" : "接入域名"}
                </Button>
              </form>
              {routes.length > 0 && (
                <div className="grid gap-3">
                  {routes.map((rt) => (
                    <div key={rt.id} className="grid gap-2 rounded-md border border-border p-3" data-testid="ing-row">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-medium">{rt.domain}</span>
                          <span className="ml-2 text-sm text-muted-foreground">
                            → :{rt.port} · {rt.preset}
                          </span>
                          <Badge
                            variant={rt.status === "active" ? "ok" : rt.status === "rejected" ? "danger" : "warn"}
                            className="ml-2"
                          >
                            {rt.status === "active" ? "已生效" : rt.status === "pending_approval" ? "待审批" : rt.status === "rejected" ? "已驳回" : rt.status}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1">
                          {rt.status === "pending_approval" && (
                            <>
                              <Button type="button" variant="outline" size="sm" onClick={() => void approveRoute(rt.id)}>
                                批准
                              </Button>
                              <Button type="button" variant="outline" size="sm" onClick={() => void rejectRoute(rt.id)}>
                                驳回
                              </Button>
                            </>
                          )}
                          <Button type="button" variant="ghost" size="sm" onClick={() => void removeRoute(rt.id)}>
                            移除
                          </Button>
                        </div>
                      </div>
                      {rt.reject_reason && (
                        <p className="m-0 text-sm text-destructive">驳回原因：{rt.reject_reason}</p>
                      )}
                      {rt.dns_hint && <p className="m-0 text-sm text-muted-foreground">{rt.dns_hint}</p>}
                      {rt.nginx_preview && (
                        <pre className="m-0 max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs">{rt.nginx_preview}</pre>
                      )}
                    </div>
                  ))}
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
