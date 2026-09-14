import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Box, Cpu, Download, Play, RefreshCw, Trash2 } from "lucide-react";
import { api, friendlyError, type AuthUser } from "@/providers";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Elevated } from "@/lib/elevated";
import { useToast } from "@/ui";
import { Hint } from "@/components/ui/tooltip";
import { canApproveRole, type Workspace } from "./types";
import {
  emptyK8sStatus,
  podPhaseLabel,
  podPhaseVariant,
  quotaLine,
  releaseLabel,
  replicaText,
  type K8sNamespaceStatus,
  type K8sResource,
} from "./k8s-status";

const SAMPLE_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
spec:
  replicas: 1
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels:
      app: demo
  template:
    metadata:
      labels:
        app: demo
    spec:
      containers:
        - name: demo
          image: nginx:stable
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 128Mi
`;

function labelsText(labels?: Record<string, string>): string {
  if (!labels) return "";
  return Object.entries(labels)
    .slice(0, 4)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
}

export function K8sPanel({
  ws,
  myRole,
  platformRole,
  opsLocked,
}: {
  ws: Workspace;
  myRole?: string;
  platformRole?: AuthUser["platform_role"];
  opsLocked?: boolean;
}) {
  const toast = useToast();
  const [yaml, setYaml] = useState(SAMPLE_YAML);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<K8sNamespaceStatus>(emptyK8sStatus(ws.runtime_ref || ""));
  const [listErr, setListErr] = useState("");
  const canApply = !opsLocked && (canApproveRole(myRole, platformRole) || myRole === "developer" || myRole === "owner" || myRole === "admin");
  const running = ws.status === "running" || ws.status === "fabric_degraded";

  const loadStatus = useCallback(async () => {
    setListErr("");
    try {
      const json = await api<K8sNamespaceStatus>(`/workspaces/${ws.id}/k8s/status`);
      setStatus({
        ...emptyK8sStatus(json.namespace || ws.runtime_ref || ""),
        ...json,
        deployments: json.deployments ?? [],
        replica_sets: json.replica_sets ?? [],
        pods: json.pods ?? [],
        services: json.services ?? [],
        events: json.events ?? [],
        warnings: json.warnings ?? [],
        resources: json.resources ?? [],
      });
    } catch (e) {
      setListErr(friendlyError(e));
      setStatus(emptyK8sStatus(ws.runtime_ref || ""));
    }
  }, [ws.id, ws.runtime_ref]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function onApply() {
    setBusy(true);
    try {
      await api(`/workspaces/${ws.id}/k8s/apply`, {
        method: "POST",
        body: JSON.stringify({ yaml }),
      });
      toast.show("已应用清单", "success");
      await loadStatus();
    } catch (e) {
      toast.show(friendlyError(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function onDownloadKubeconfig() {
    try {
      const json = await api<{ kubeconfig: string }>(`/workspaces/${ws.id}/kubeconfig`);
      const blob = new Blob([json.kubeconfig || ""], { type: "text/yaml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${ws.name || "workspace"}.kubeconfig`;
      a.click();
      URL.revokeObjectURL(url);
      toast.show("已下载 kubeconfig", "success");
    } catch (e) {
      toast.show(friendlyError(e), "error");
    }
  }

  async function onDelete(row: K8sResource) {
    setBusy(true);
    try {
      await api(
        `/workspaces/${ws.id}/k8s/resources?kind=${encodeURIComponent(row.kind)}&name=${encodeURIComponent(row.name)}`,
        { method: "DELETE" },
      );
      toast.show(`已删除 ${row.kind}/${row.name}`, "success");
      await loadStatus();
    } catch (e) {
      toast.show(friendlyError(e), "error");
    } finally {
      setBusy(false);
    }
  }

  const quotaText = quotaLine(status.quota?.hard, status.quota?.used);
  const warningEvents = status.events.filter((ev) => ev.type === "Warning");

  return (
    <Elevated offset={1} shadowLevel={1} className="overflow-hidden rounded-xl border border-border/80 bg-surface-1">
      <Card>
        <CardHeader>
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-surface-2 text-primary">
              <Box className="size-4 shrink-0" />
            </span>
            <div className="min-w-0">
              <CardTitle>Kubernetes 清单</CardTitle>
              <CardDescription className="min-w-0 break-words">
                粘贴 YAML 后一键 apply。平台会强制改写到本机 Namespace
                {ws.runtime_ref ? `（${ws.runtime_ref}）` : ""}，并拒绝集群级对象。容器必须写{" "}
                <code className="font-mono text-[12px]">resources.requests.cpu/memory</code>
                ，否则会被 project-quota 拦住。
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {!running && (
            <Alert>
              <AlertDescription>机器尚未运行，开通完成后再应用清单。</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              data-testid="ws-k8s-refresh"
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              onClick={() => void loadStatus()}
              disabled={!running}
            >
              <RefreshCw className="size-3.5 shrink-0" />
              刷新状态
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="ws-k8s-kubeconfig"
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              onClick={() => void onDownloadKubeconfig()}
              disabled={!running || !canApply}
            >
              <Download className="size-3.5 shrink-0" />
              下载 kubeconfig
            </Button>
          </div>
          <Field label="YAML">
            <Textarea
              data-testid="ws-k8s-yaml"
              value={yaml}
              onChange={(e) => setYaml(e.target.value)}
              className="min-h-48 font-mono text-xs"
              disabled={!canApply}
            />
          </Field>
          <div className="flex justify-end">
            <Button
              type="button"
              data-testid="ws-k8s-apply"
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              disabled={busy || !running || !canApply}
              onClick={() => void onApply()}
            >
              <Play className="size-3.5 shrink-0" />
              {busy ? "应用中…" : "应用清单"}
            </Button>
          </div>
          {listErr && (
            <Alert variant="destructive">
              <AlertDescription>{listErr}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-3" data-testid="ws-k8s-status">
            {status.warnings.length > 0 && (
              <Alert variant="destructive" data-testid="ws-k8s-warnings">
                <AlertTriangle className="size-4 shrink-0" />
                <AlertDescription className="min-w-0 break-words">
                  <ul className="grid gap-1">
                    {status.warnings.slice(0, 8).map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="inline-flex items-center gap-1 whitespace-nowrap shrink-0">
                Deployment {status.summary.ready_deployments}/{status.summary.deployments}
              </Badge>
              <Badge variant="secondary" className="inline-flex items-center gap-1 whitespace-nowrap shrink-0">
                Pod {status.summary.running_pods}/{status.summary.pods}
              </Badge>
              {status.summary.pending_pods > 0 && (
                <Badge variant="warn" className="inline-flex items-center gap-1 whitespace-nowrap shrink-0">
                  等待 {status.summary.pending_pods}
                </Badge>
              )}
              {status.summary.failed_pods > 0 && (
                <Badge variant="danger" className="inline-flex items-center gap-1 whitespace-nowrap shrink-0">
                  失败 {status.summary.failed_pods}
                </Badge>
              )}
            </div>

            {quotaText ? (
              <div
                data-testid="ws-k8s-quota"
                className="inline-flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-foreground"
              >
                <Cpu className="size-3.5 shrink-0 text-muted-foreground opacity-70" />
                <span className="whitespace-nowrap shrink-0">配额 {status.quota?.name || "project-quota"}</span>
                <Hint label={quotaText} className="font-mono">
                  <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{quotaText}</span>
                </Hint>
              </div>
            ) : null}

            {status.deployments.length > 0 && (
              <div className="w-full overflow-x-auto rounded-xl border border-border/80" data-testid="ws-k8s-deployments">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-surface-2/80 backdrop-blur-xs">
                    <TableRow>
                      <TableHead className="min-w-0">Deployment</TableHead>
                      <TableHead className="w-[110px] whitespace-nowrap">就绪</TableHead>
                      <TableHead className="w-[160px] whitespace-nowrap">滚动策略</TableHead>
                      <TableHead className="w-[140px] whitespace-nowrap">标签</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {status.deployments.map((d) => (
                      <TableRow key={d.name}>
                        <TableCell className="min-w-0 truncate font-medium">{d.name}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Hint label={`ready ${d.ready_replicas}/${d.replicas}`}>
                            <Badge
                              variant={d.ready_replicas >= d.replicas && d.replicas > 0 && !d.rolling ? "ok" : "warn"}
                              className="inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                            >
                              {replicaText(d.ready_replicas, d.replicas)}
                            </Badge>
                          </Hint>
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs">
                          {d.strategy || "RollingUpdate"}
                          {d.max_unavailable != null && d.max_unavailable !== "" ? ` u=${d.max_unavailable}` : ""}
                          {d.max_surge != null && d.max_surge !== "" ? ` s=${d.max_surge}` : ""}
                        </TableCell>
                        <TableCell className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                          {releaseLabel(d.labels) || labelsText(d.labels) || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {status.replica_sets.length > 0 && (
              <div className="w-full overflow-x-auto rounded-xl border border-border/80">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-surface-2/80 backdrop-blur-xs">
                    <TableRow>
                      <TableHead className="min-w-0">ReplicaSet</TableHead>
                      <TableHead className="w-[90px] whitespace-nowrap">代</TableHead>
                      <TableHead className="w-[110px] whitespace-nowrap">副本</TableHead>
                      <TableHead className="w-[140px] whitespace-nowrap">标签</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {status.replica_sets.map((rs) => (
                      <TableRow key={rs.name}>
                        <TableCell className="min-w-0 truncate font-mono text-xs">{rs.name}</TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs">{rs.generation || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs">
                          {replicaText(rs.ready, rs.desired)}
                        </TableCell>
                        <TableCell className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                          {releaseLabel(rs.labels) || labelsText(rs.labels) || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="w-full overflow-x-auto rounded-xl border border-border/80" data-testid="ws-k8s-pods">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-surface-2/80 backdrop-blur-xs">
                  <TableRow>
                    <TableHead className="min-w-0">Pod</TableHead>
                    <TableHead className="w-[120px] whitespace-nowrap">阶段</TableHead>
                    <TableHead className="w-[90px] whitespace-nowrap">重启</TableHead>
                    <TableHead className="w-[140px] whitespace-nowrap">标签</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {status.pods.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-sm text-muted-foreground">
                        还没有 Pod。apply 之后点「刷新状态」查看轮替；不要到别的 Docker 机器上 exec kubectl。
                      </TableCell>
                    </TableRow>
                  ) : (
                    status.pods.map((p) => (
                      <TableRow key={p.name}>
                        <TableCell className="min-w-0 truncate font-mono text-xs">{p.name}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Hint label={p.reason ? `${p.phase} ${p.reason}` : p.phase} className="font-mono">
                            <Badge
                              variant={podPhaseVariant(p.phase, p.ready)}
                              className="inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                            >
                              {podPhaseLabel(p.phase)}
                            </Badge>
                          </Hint>
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs">{p.restarts}</TableCell>
                        <TableCell className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                          {releaseLabel(p.labels) || labelsText(p.labels) || "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {warningEvents.length > 0 && (
              <div className="w-full overflow-x-auto rounded-xl border border-border/80">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-surface-2/80 backdrop-blur-xs">
                    <TableRow>
                      <TableHead className="w-[140px] whitespace-nowrap">事件</TableHead>
                      <TableHead className="min-w-0">说明</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {warningEvents.slice(0, 8).map((ev, i) => (
                      <TableRow key={`${ev.reason}-${ev.object_name}-${i}`}>
                        <TableCell className="whitespace-nowrap">
                          <Badge variant="danger" className="inline-flex items-center gap-1 whitespace-nowrap shrink-0">
                            {ev.reason || "Warning"}
                          </Badge>
                        </TableCell>
                        <TableCell className="min-w-0 break-words text-sm text-foreground">
                          {[ev.object_kind, ev.object_name].filter(Boolean).join("/")} {ev.message}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div className="w-full overflow-x-auto rounded-xl border border-border/80" data-testid="ws-k8s-resources">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-surface-2/80 backdrop-blur-xs">
                <TableRow>
                  <TableHead className="w-[140px] whitespace-nowrap">Kind</TableHead>
                  <TableHead className="min-w-0">名称</TableHead>
                  <TableHead className="w-[110px] whitespace-nowrap">状态</TableHead>
                  <TableHead className="w-[180px] whitespace-nowrap">Namespace</TableHead>
                  <TableHead className="w-[80px] whitespace-nowrap text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.resources.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-sm text-muted-foreground">
                      还没有已应用的资源。
                    </TableCell>
                  </TableRow>
                ) : (
                  status.resources.map((row) => (
                    <TableRow key={`${row.kind}/${row.name}`}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{row.kind}</TableCell>
                      <TableCell className="min-w-0 truncate font-medium">{row.name}</TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {row.ready || row.phase || "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                        {row.namespace || ws.runtime_ref || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {canApply && (
                          <Hint label={`删除 ${row.kind}/${row.name}`}>
                            <Button
                              type="button"
                              variant="ghost"
                              size="compact"
                              className="size-6 p-0 shrink-0"
                              disabled={busy}
                              onClick={() => void onDelete(row)}
                            >
                              <Trash2 className="size-3.5 shrink-0" />
                            </Button>
                          </Hint>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </Elevated>
  );
}
