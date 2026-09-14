import { useCallback, useEffect, useState } from "react";
import { Box, Download, Play, Trash2 } from "lucide-react";
import { api, friendlyError, type AuthUser } from "@/providers";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Elevated } from "@/lib/elevated";
import { useToast } from "@/ui";
import { Hint } from "@/components/ui/tooltip";
import { canApproveRole, type Workspace } from "./types";

type K8sResource = {
  kind: string;
  name: string;
  namespace: string;
};

const SAMPLE_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
spec:
  replicas: 1
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
`;

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
  const [resources, setResources] = useState<K8sResource[]>([]);
  const [listErr, setListErr] = useState("");
  const canApply = !opsLocked && (canApproveRole(myRole, platformRole) || myRole === "developer" || myRole === "owner" || myRole === "admin");
  const running = ws.status === "running" || ws.status === "fabric_degraded";

  const loadResources = useCallback(async () => {
    setListErr("");
    try {
      const json = await api<{ data: K8sResource[] }>(`/workspaces/${ws.id}/k8s/resources`);
      setResources(json.data ?? []);
    } catch (e) {
      setListErr(friendlyError(e));
      setResources([]);
    }
  }, [ws.id]);

  useEffect(() => {
    void loadResources();
  }, [loadResources]);

  async function onApply() {
    setBusy(true);
    try {
      await api(`/workspaces/${ws.id}/k8s/apply`, {
        method: "POST",
        body: JSON.stringify({ yaml }),
      });
      toast.show("已应用清单", "success");
      await loadResources();
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
      await loadResources();
    } catch (e) {
      toast.show(friendlyError(e), "error");
    } finally {
      setBusy(false);
    }
  }

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
                {ws.runtime_ref ? `（${ws.runtime_ref}）` : ""}，并拒绝集群级对象。
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
          <div className="w-full overflow-x-auto rounded-xl border border-border/80" data-testid="ws-k8s-resources">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-surface-2/80 backdrop-blur-xs">
                <TableRow>
                  <TableHead className="w-[140px] whitespace-nowrap">Kind</TableHead>
                  <TableHead className="min-w-0">名称</TableHead>
                  <TableHead className="w-[180px] whitespace-nowrap">Namespace</TableHead>
                  <TableHead className="w-[80px] whitespace-nowrap text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resources.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-sm text-muted-foreground">
                      还没有已应用的资源。
                    </TableCell>
                  </TableRow>
                ) : (
                  resources.map((row) => (
                    <TableRow key={`${row.kind}/${row.name}`}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{row.kind}</TableCell>
                      <TableCell className="min-w-0 truncate font-medium">{row.name}</TableCell>
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
