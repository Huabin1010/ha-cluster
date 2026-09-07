import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useOne } from "@refinedev/core";
import { api, friendlyError, isApiError } from "../../providers";
import { formatPlanSpec, Workspace, workspaceSpec } from "./types";
import { ImportKeyDialog } from "./ImportKeyDialog";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Field } from "../../components/ui/field";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { SelectBox } from "../../components/ui/select";
import { Badge } from "../../components/ui/badge";
import { PageFrame } from "../../components/ui/page-frame";
import { PageHeader, Loading, useToast } from "../../ui";
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
} from "../../components/ui/alert-dialog";

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
};

type IngressMeta = {
  public_host: string;
  note?: string;
  presets: Array<{ id: string; label: string; description: string }>;
};

export function MachinePage() {
  const { id = "" } = useParams();
  const toast = useToast();
  const { data, isLoading, isError, error } = useOne<Workspace>({ resource: "workspaces", id });
  const ws = data?.data;

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
  const [pendingBody, setPendingBody] = useState<Record<string, unknown> | null>(null);

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

  useEffect(() => {
    void loadConn();
    void loadIngress();
    api<IngressMeta>("/ingress/meta")
      .then(setMeta)
      .catch(() => setMeta(null));
  }, [loadConn, loadIngress]);

  async function copy(text: string, ok: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.show(ok, "success");
    } catch {
      toast.show("复制失败，请手动选择", "error");
    }
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
  const canConnect = ws.status === "running" || ws.status === "fabric_degraded";

  return (
    <PageFrame
      header={
        <div className="grid gap-2">
          <Button variant="link" className="h-auto w-fit p-0" asChild>
            <Link to={ws.project_id ? `/workspaces?project_id=${encodeURIComponent(ws.project_id)}` : "/workspaces"}>
              ← 服务器
            </Link>
          </Button>
          <PageHeader
            title={ws.name}
            description={
              spec
                ? `${ws.plan} · ${formatPlanSpec(spec)} · 独立隔离主机（即便与别的机器在同一物理节点上，进程/磁盘/网络也不互通）`
                : `${ws.plan} · 独立隔离主机`
            }
          />
        </div>
      }
    >
      <div className="grid gap-6 pb-8">
        <Card>
          <CardHeader>
            <CardTitle>SSH 连接</CardTitle>
            <CardDescription>
              导入自己的受信任公钥后，复制命令即可连上。文件用 scp 上传；主机内已预装 Docker，允许自行 docker pull。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {!canConnect && <p className="m-0 text-sm text-muted-foreground">机器尚未运行，开通后才会给出连接信息。</p>}
            {connErr && (
              <Alert variant="destructive">
                <AlertDescription>{connErr}</AlertDescription>
              </Alert>
            )}
            {conn && (
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
                        <Badge variant="outline" className="ml-2">
                          {rt.status}
                        </Badge>
                      </div>
                      <Button type="button" variant="ghost" size="sm" onClick={() => void removeRoute(rt.id)}>
                        移除
                      </Button>
                    </div>
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
