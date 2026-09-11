import { FormEvent, useCallback, useEffect, useState } from "react";
import { useGetIdentity } from "@refinedev/core";
import { Check, CheckCircle2, Globe, Layers, Lock, Play, Plus, RefreshCw, Shield, SlidersHorizontal, Trash2, User, X } from "lucide-react";
import { api, friendlyError } from "@/providers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageFrame } from "@/components/ui/page-frame";
import { Elevated } from "@/lib/elevated";
import { Hint } from "@/components/ui/tooltip";
import { Loading } from "@/ui";
import { toast } from "sonner";
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

type Registry = {
  id: string;
  name: string;
  server: string;
  username: string;
  auto_inject: boolean;
  has_secret: boolean;
};

type Identity = { platform_role?: string };

export function DockerRegistriesPage() {
  const { data: me } = useGetIdentity<Identity>();
  const isAdmin = me?.platform_role === "platform_admin";
  const [rows, setRows] = useState<Registry[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Registry | null>(null);

  const [name, setName] = useState("");
  const [server, setServer] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [autoInject, setAutoInject] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ data: Registry[] }>("/admin/docker-registries");
      setRows(data.data ?? []);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/admin/docker-registries", {
        method: "POST",
        body: JSON.stringify({ name, server, username, password, auto_inject: autoInject }),
      });
      toast.success("已添加镜像仓库配置");
      setOpen(false);
      setName("");
      setServer("");
      setUsername("");
      setPassword("");
      await load();
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleInject(row: Registry) {
    try {
      await api(`/admin/docker-registries/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ auto_inject: !row.auto_inject }),
      });
      toast.success(`已${!row.auto_inject ? "开启" : "关闭"}自动注入`);
      await load();
    } catch (e) {
      toast.error(friendlyError(e));
    }
  }

  async function testRow(row: Registry) {
    setTestingId(row.id);
    try {
      const res = await api<{ ok: boolean; error?: string }>(`/admin/docker-registries/${row.id}/test`, {
        method: "POST",
      });
      if (res.ok) toast.success(`${row.server} 凭据鉴权成功通过`);
      else toast.error(res.error || "连通性与凭据鉴权失败");
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setTestingId(null);
    }
  }

  async function removeRow() {
    if (!deleteTarget) return;
    try {
      await api(`/admin/docker-registries/${deleteTarget.id}`, { method: "DELETE" });
      toast.success("已删除镜像仓库凭据");
      setDeleteTarget(null);
      await load();
    } catch (e) {
      toast.error(friendlyError(e));
    }
  }

  if (!isAdmin) {
    return (
      <PageFrame
        header={
          <div className="flex items-center gap-3">
            <span className="size-9 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center shrink-0 border border-destructive/20 shadow-xs">
              <Shield className="size-4.5" />
            </span>
            <div>
              <h2 className="m-0 text-xl font-bold tracking-tight text-foreground">私有镜像仓库</h2>
              <p className="mt-1 mb-0 text-sm text-muted-foreground">访问受限</p>
            </div>
          </div>
        }
      >
        <div className="py-8 flex justify-center">
          <Elevated
            offset={1}
            shadowLevel={2}
            className="rounded-2xl border border-destructive/30 bg-destructive/5 p-8 max-w-md w-full text-center flex flex-col items-center gap-3"
          >
            <Shield className="size-10 text-destructive" />
            <h3 className="m-0 text-base font-semibold text-foreground">无权配置镜像仓库</h3>
            <p className="m-0 text-xs text-muted-foreground leading-relaxed">
              仅平台超级管理员 (platform_admin) 可管理全局 Docker Registry 鉴权与自动注入凭据。
            </p>
          </Elevated>
        </div>
      </PageFrame>
    );
  }

  const activeInjectCount = rows.filter((r) => r.auto_inject).length;

  return (
    <>
      <PageFrame
        header={
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="size-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 border border-primary/20 shadow-xs">
                  <Layers className="size-4.5" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h2 className="m-0 text-xl font-bold tracking-tight text-foreground">私有镜像仓库</h2>
                    <Badge variant="outline" className="px-2 py-0.5 text-xs font-mono font-normal">
                      {rows.length} 个配置
                    </Badge>
                  </div>
                  <p className="mt-1 mb-0 text-sm text-muted-foreground">
                    配置私有或内网 Docker Registry 认证凭据。开启自动注入后，新开通的工作区将自动具备私有镜像拉取权限。
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="compact"
                  data-testid="registries-refresh"
                  onClick={() => void load()}
                  disabled={loading}
                  className="h-8 px-3 text-xs gap-1.5 shrink-0"
                >
                  <RefreshCw className="size-3.5 opacity-70 shrink-0" />
                  刷新
                </Button>

                <Dialog open={open} onOpenChange={setOpen}>
                  <DialogTrigger asChild>
                    <Button type="button" size="compact" data-testid="registries-add-open" className="h-8 px-3 text-xs gap-1.5 shrink-0">
                      <Plus className="size-3.5 shrink-0" />
                      添加仓库
                    </Button>
                  </DialogTrigger>
                  <DialogContent size="lg" className="sm:max-w-xl">
                    <DialogHeader>
                      <DialogTitle>添加私有镜像仓库</DialogTitle>
                      <DialogDescription>
                        配置私有 Docker 凭据，密钥将通过平台 SecretBox 加密存储并在工作区拉起时安全写入。
                      </DialogDescription>
                    </DialogHeader>
                    <form className="flex min-h-0 flex-1 flex-col" onSubmit={onCreate}>
                      <DialogBody className="grid gap-4 overflow-x-hidden overflow-y-auto max-w-full">
                        <Field label="仓库标识名称">
                          <Input
                            data-testid="registries-name"
                            placeholder="例如：Nexus 私服 / ACR"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                            autoComplete="off"
                          />
                        </Field>
                        <Field label="Registry 服务器地址">
                          <Input
                            data-testid="registries-server"
                            placeholder="例如：registry.example.com 或 192.168.1.9:5000"
                            value={server}
                            onChange={(e) => setServer(e.target.value)}
                            required
                            autoComplete="off"
                          />
                        </Field>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Field label="用户名">
                            <Input
                              data-testid="registries-username"
                              placeholder="docker pull 登录账号"
                              value={username}
                              onChange={(e) => setUsername(e.target.value)}
                              autoComplete="off"
                            />
                          </Field>
                          <Field label="密码 / Access Token">
                            <Input
                              data-testid="registries-password"
                              type="password"
                              placeholder="登录密码或访问令牌"
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              autoComplete="off"
                            />
                          </Field>
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-xl border border-border/80 bg-surface-2/40">
                          <div>
                            <span className="text-xs font-medium text-foreground block">自动注入至新开通的工作区</span>
                            <span className="text-[11px] text-muted-foreground block mt-0.5">
                              开启后所有隔离容器内的 Docker 守护进程将自动携带该仓库凭证
                            </span>
                          </div>
                          <Switch label="自动注入" checked={autoInject} onToggle={() => setAutoInject((v) => !v)} />
                        </div>
                      </DialogBody>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                          取消
                        </Button>
                        <Button data-testid="registries-submit" disabled={busy || !server.trim() || !name.trim()} type="submit">
                          {busy ? "添加中…" : "确认添加"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            {/* 指标条 */}
            <div className="grid grid-cols-2 gap-3">
              <Elevated
                offset={1}
                shadowLevel={1}
                className="rounded-xl border border-border/80 bg-surface-1 p-3.5 shadow-surface-1 flex flex-col justify-between"
              >
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium flex items-center gap-1.5">
                    <Layers className="size-3.5 text-primary" /> 已配置私有 Registry
                  </span>
                </div>
                <div className="text-xl font-bold tracking-tight text-foreground font-mono mt-1">
                  {rows.length} <span className="text-xs font-normal text-muted-foreground">个</span>
                </div>
              </Elevated>

              <Elevated
                offset={1}
                shadowLevel={1}
                className="rounded-xl border border-border/80 bg-surface-1 p-3.5 shadow-surface-1 flex flex-col justify-between"
              >
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5 text-emerald-500" /> 已启用自动注入
                  </span>
                </div>
                <div className="text-xl font-bold tracking-tight text-foreground font-mono mt-1">
                  {activeInjectCount} <span className="text-xs font-normal text-muted-foreground">个</span>
                </div>
              </Elevated>
            </div>
          </div>
        }
      >
        {loading ? (
          <div className="py-12 text-center">
            <Loading label="加载镜像仓库配置…" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-8 flex flex-col items-center justify-center">
            <Elevated
              offset={1}
              shadowLevel={2}
              className="rounded-2xl border border-border/80 bg-surface-1 p-8 shadow-surface-2 text-center max-w-md w-full flex flex-col items-center gap-3"
            >
              <div className="size-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20 shadow-xs">
                <Layers className="size-6" />
              </div>
              <div>
                <h3 className="m-0 text-base font-semibold text-foreground">未配置私有镜像仓库</h3>
                <p className="m-0 mt-1.5 text-xs text-muted-foreground leading-relaxed">
                  若要在工作区内直接拉取团队自建 Harbor、ACR、Nexus 私有镜像，可点击右上角「添加仓库」录入凭证。
                </p>
              </div>
            </Elevated>
          </div>
        ) : (
          <div className="w-full overflow-x-auto rounded-xl border border-border/80 bg-surface-1 shadow-surface-1">
            <Table data-testid="registries-table" className="min-w-[780px]">
              <TableHeader className="bg-surface-2/60 border-b border-border/70 select-none">
                <TableRow className="border-b border-border/60 hover:bg-transparent">
                  <TableHead className="py-2.5">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <Layers className="size-3.5 opacity-60 shrink-0" />
                      仓库名称
                    </span>
                  </TableHead>
                  <TableHead className="w-[260px] py-2.5">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <Globe className="size-3.5 opacity-60 shrink-0" />
                      服务地址 (Server)
                    </span>
                  </TableHead>
                  <TableHead className="w-[150px] py-2.5">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <User className="size-3.5 opacity-60 shrink-0" />
                      登录账号
                    </span>
                  </TableHead>
                  <TableHead className="w-[140px] py-2.5">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <CheckCircle2 className="size-3.5 opacity-60 shrink-0" />
                      自动注入
                    </span>
                  </TableHead>
                  <TableHead className="w-[200px] text-right py-2.5 pr-4">
                    <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap w-full">
                      <SlidersHorizontal className="size-3.5 opacity-60 shrink-0" />
                      操作
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} data-testid="registries-row">
                    <TableCell className="py-2.5 font-medium whitespace-nowrap text-foreground">
                      <div className="inline-flex items-center gap-2">
                        <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] shrink-0" />
                        <span>{r.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="mono font-mono text-xs py-2.5 whitespace-nowrap text-muted-foreground">
                      <span className="bg-muted/40 px-2 py-0.5 rounded border border-border/50 text-foreground font-mono">
                        {r.server}
                      </span>
                    </TableCell>
                    <TableCell className="mono font-mono text-xs py-2.5 whitespace-nowrap text-muted-foreground">
                      {r.username || "（匿名访问）"}
                    </TableCell>
                    <TableCell className="py-2.5 whitespace-nowrap">
                      <Badge
                        variant={r.auto_inject ? "ok" : "outline"}
                        data-testid="registries-inject-toggle"
                        className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
                        onClick={() => void toggleInject(r)}
                      >
                        {r.auto_inject ? (
                          <>
                            <Check className="size-3 text-emerald-500 shrink-0" />
                            已启用
                          </>
                        ) : (
                          <>
                            <X className="size-3 opacity-60 shrink-0" />
                            未注入
                          </>
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right py-2.5 w-[200px] pr-4">
                      <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                        <Button
                          type="button"
                          variant="outline"
                          size="compact"
                          data-testid="registries-test"
                          disabled={testingId === r.id}
                          className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-7 text-xs px-2"
                          onClick={() => void testRow(r)}
                        >
                          <Play className="size-3 text-primary shrink-0" />
                          {testingId === r.id ? "测试中…" : "测连通"}
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="compact"
                          data-testid="registries-delete"
                          className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-7 text-xs px-2"
                          onClick={() => setDeleteTarget(r)}
                        >
                          <Trash2 className="size-3.5 shrink-0" />
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </PageFrame>

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除镜像仓库凭据</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <AlertDialogDescription>
              确定删除镜像仓库「{deleteTarget?.name}」({deleteTarget?.server})？删除后新创建的工作区将不再自动挂载该 Registry 鉴权信息。
            </AlertDialogDescription>
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="confirm-cancel">取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" data-testid="confirm-ok" onClick={() => void removeRow()}>确定删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
