import { FormEvent, useCallback, useEffect, useState } from "react";
import { useGetIdentity } from "@refinedev/core";
import { CheckCircle2, Globe, Plus, RefreshCw, Shield, Trash2 } from "lucide-react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageFrame } from "@/components/ui/page-frame";
import { PageHeading } from "@/components/ui/page-heading";
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

type Zone = {
  id: string;
  suffix: string;
  display_name: string;
  require_approval: boolean;
  enabled: boolean;
  allow_random: boolean;
  allow_custom_prefix: boolean;
  sort_order: number;
};

type Identity = { platform_role?: string };

export function IngressDomainsPage() {
  const { data: me } = useGetIdentity<Identity>();
  const isAdmin = me?.platform_role === "platform_admin";
  const [rows, setRows] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Zone | null>(null);

  const [suffix, setSuffix] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [requireApproval, setRequireApproval] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [allowRandom, setAllowRandom] = useState(true);
  const [allowCustom, setAllowCustom] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ data: Zone[] }>("/admin/ingress-domains");
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

  function resetForm() {
    setSuffix("");
    setDisplayName("");
    setRequireApproval(false);
    setEnabled(true);
    setAllowRandom(true);
    setAllowCustom(true);
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/admin/ingress-domains", {
        method: "POST",
        body: JSON.stringify({
          suffix: suffix.trim(),
          display_name: displayName.trim() || suffix.trim(),
          require_approval: requireApproval,
          enabled,
          allow_random: requireApproval ? false : allowRandom,
          allow_custom_prefix: requireApproval ? false : allowCustom,
        }),
      });
      toast.success("已添加域名后缀");
      setOpen(false);
      resetForm();
      await load();
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(row: Zone) {
    try {
      await api(`/admin/ingress-domains/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !row.enabled }),
      });
      toast.success(`已${!row.enabled ? "启用" : "停用"} ${row.suffix}`);
      await load();
    } catch (e) {
      toast.error(friendlyError(e));
    }
  }

  async function removeRow() {
    if (!deleteTarget) return;
    try {
      await api(`/admin/ingress-domains/${deleteTarget.id}`, { method: "DELETE" });
      toast.success("已删除域名后缀");
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
              <h2 className="m-0 text-xl font-bold tracking-tight text-foreground">域名配置</h2>
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
            <h3 className="m-0 text-base font-semibold text-foreground">无权配置域名后缀</h3>
            <p className="m-0 text-xs text-muted-foreground leading-relaxed">
              仅平台超级管理员 (platform_admin) 可管理 Ingress 公共域与需审后缀。
            </p>
          </Elevated>
        </div>
      </PageFrame>
    );
  }

  const freeCount = rows.filter((r) => !r.require_approval && r.enabled).length;

  return (
    <>
      <PageFrame
        header={
          <PageHeading
            icon={Globe}
            title="域名配置"
            badges={
              <Badge
                variant="outline"
                className="inline-flex items-center whitespace-nowrap shrink-0 px-2 py-0.5 text-xs font-mono font-normal"
              >
                {rows.length} 个后缀
              </Badge>
            }
            description="配置平台域名后缀。免审后缀允许用户随机或自定义前缀立即生效；需审后缀与自有域名走项目审批。"
            actions={
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                <Button
                  type="button"
                  variant="outline"
                  size="compact"
                  data-testid="ing-zone-refresh"
                  onClick={() => void load()}
                  disabled={loading}
                  className="h-8 px-3 text-xs gap-1.5 shrink-0"
                >
                  <RefreshCw className="size-3.5 opacity-70 shrink-0" />
                  刷新
                </Button>
                <Dialog
                  open={open}
                  onOpenChange={(v) => {
                    setOpen(v);
                    if (!v) resetForm();
                  }}
                >
                  <DialogTrigger asChild>
                    <Button type="button" size="compact" data-testid="ing-zone-create" className="h-8 px-3 text-xs gap-1.5 shrink-0">
                      <Plus className="size-3.5 shrink-0" />
                      添加后缀
                    </Button>
                  </DialogTrigger>
                  <DialogContent size="lg" className="sm:max-w-xl">
                    <DialogHeader>
                      <DialogTitle>添加域名后缀</DialogTitle>
                      <DialogDescription className="break-words min-w-0">
                        填写不含 `*.` 的后缀（如 apps.example.com）。免审域可开放随机/自定义前缀领取。
                      </DialogDescription>
                    </DialogHeader>
                    <form className="flex min-h-0 flex-1 flex-col" onSubmit={(e) => void onCreate(e)}>
                      <DialogBody className="grid gap-4 overflow-x-hidden overflow-y-auto max-w-full">
                        <Field label="域名后缀">
                          <Input
                            data-testid="ing-zone-suffix"
                            placeholder="apps.example.com"
                            value={suffix}
                            onChange={(e) => setSuffix(e.target.value)}
                            required
                            autoComplete="off"
                          />
                        </Field>
                        <Field label="展示名称">
                          <Input
                            data-testid="ing-zone-name"
                            placeholder="公共应用域"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            autoComplete="off"
                          />
                        </Field>
                        <div className="flex items-center justify-between p-3 rounded-xl border border-border/80 bg-surface-2/40">
                          <div className="min-w-0">
                            <span className="text-xs font-medium text-foreground block">需要项目审批</span>
                            <span className="text-[11px] text-muted-foreground block mt-0.5 break-words">
                              关闭则为免审公共域，用户可立即领取子域名
                            </span>
                          </div>
                          <Switch
                            label="需审批"
                            checked={requireApproval}
                            onToggle={() => setRequireApproval((v) => !v)}
                          />
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-xl border border-border/80 bg-surface-2/40">
                          <div className="min-w-0">
                            <span className="text-xs font-medium text-foreground block">对用户可见</span>
                          </div>
                          <Switch label="启用" checked={enabled} onToggle={() => setEnabled((v) => !v)} />
                        </div>
                        {!requireApproval && (
                          <>
                            <div className="flex items-center justify-between p-3 rounded-xl border border-border/80 bg-surface-2/40">
                              <span className="text-xs font-medium text-foreground">允许随机前缀</span>
                              <Switch label="随机" checked={allowRandom} onToggle={() => setAllowRandom((v) => !v)} />
                            </div>
                            <div className="flex items-center justify-between p-3 rounded-xl border border-border/80 bg-surface-2/40">
                              <span className="text-xs font-medium text-foreground">允许自定义前缀</span>
                              <Switch label="自定义" checked={allowCustom} onToggle={() => setAllowCustom((v) => !v)} />
                            </div>
                          </>
                        )}
                      </DialogBody>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                          取消
                        </Button>
                        <Button data-testid="ing-zone-submit" disabled={busy || !suffix.trim()} type="submit">
                          {busy ? "添加中…" : "确认添加"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <Elevated
                offset={1}
                shadowLevel={1}
                className="rounded-xl border border-border/80 bg-surface-1 p-3.5 shadow-surface-1 flex flex-col justify-between"
              >
                <span className="text-xs font-medium text-muted-foreground inline-flex items-center gap-1.5">
                  <Globe className="size-3.5 text-primary shrink-0" /> 已配置后缀
                </span>
                <div className="text-xl font-bold tracking-tight text-foreground font-mono mt-1">
                  {rows.length} <span className="text-xs font-normal text-muted-foreground">个</span>
                </div>
              </Elevated>
              <Elevated
                offset={1}
                shadowLevel={1}
                className="rounded-xl border border-border/80 bg-surface-1 p-3.5 shadow-surface-1 flex flex-col justify-between"
              >
                <span className="text-xs font-medium text-muted-foreground inline-flex items-center gap-1.5">
                  <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" /> 启用中的免审域
                </span>
                <div className="text-xl font-bold tracking-tight text-foreground font-mono mt-1">
                  {freeCount} <span className="text-xs font-normal text-muted-foreground">个</span>
                </div>
              </Elevated>
            </div>
          </PageHeading>
        }
      >
        {loading ? (
          <div className="py-12 text-center">
            <Loading label="加载域名配置…" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-8 flex flex-col items-center justify-center">
            <Elevated
              offset={1}
              shadowLevel={2}
              className="rounded-2xl border border-border/80 bg-surface-1 p-8 shadow-surface-2 text-center max-w-md w-full flex flex-col items-center gap-3"
            >
              <div className="size-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20 shadow-xs">
                <Globe className="size-6" />
              </div>
              <div>
                <h3 className="m-0 text-base font-semibold text-foreground">尚未配置域名后缀</h3>
                <p className="m-0 mt-1.5 text-xs text-muted-foreground leading-relaxed">
                  添加如 apps.example.com 的免审公共域后，用户即可在工作区一键领取子域名。
                </p>
              </div>
            </Elevated>
          </div>
        ) : (
          <div className="w-full overflow-x-auto rounded-xl border border-border/80 bg-surface-1 shadow-surface-1">
            <Table data-testid="ing-zone-table" className="min-w-[720px]">
              <TableHeader className="sticky top-0 z-10 bg-surface-2/80 backdrop-blur-xs border-b border-border/70 select-none">
                <TableRow className="border-b border-border/60 hover:bg-transparent">
                  <TableHead className="py-2.5">名称 / 后缀</TableHead>
                  <TableHead className="w-[120px] py-2.5 whitespace-nowrap">审批</TableHead>
                  <TableHead className="w-[140px] py-2.5 whitespace-nowrap">前缀方式</TableHead>
                  <TableHead className="w-[100px] py-2.5 whitespace-nowrap">状态</TableHead>
                  <TableHead className="w-[140px] py-2.5 whitespace-nowrap">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} data-testid="ing-zone-row">
                    <TableCell className="min-w-0">
                      <div className="min-w-0">
                        <p className="m-0 truncate font-medium text-foreground">{row.display_name || row.suffix}</p>
                        <p className="m-0 mt-0.5 truncate font-mono text-xs text-muted-foreground">*.{row.suffix}</p>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge
                        variant={row.require_approval ? "warn" : "ok"}
                        className="inline-flex items-center whitespace-nowrap shrink-0"
                      >
                        {row.require_approval ? "需审批" : "免审"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {row.require_approval
                        ? "申请前缀"
                        : [row.allow_random ? "随机" : null, row.allow_custom_prefix ? "自定义" : null]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge
                        variant={row.enabled ? "ok" : "outline"}
                        className="inline-flex items-center whitespace-nowrap shrink-0"
                      >
                        {row.enabled ? "启用" : "停用"}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5 shrink-0">
                        <Button
                          type="button"
                          size="compact"
                          variant="outline"
                          className="h-7 px-2 text-xs shrink-0"
                          data-testid="ing-zone-toggle"
                          onClick={() => void toggleEnabled(row)}
                        >
                          {row.enabled ? "停用" : "启用"}
                        </Button>
                        <Hint label="删除">
                          <Button
                            type="button"
                            size="compact"
                            variant="ghost"
                            className="size-7 p-0 shrink-0 text-destructive"
                            data-testid="ing-zone-delete"
                            onClick={() => setDeleteTarget(row)}
                          >
                            <Trash2 className="size-3.5 shrink-0" />
                          </Button>
                        </Hint>
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
            <AlertDialogTitle>删除域名后缀？</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <AlertDialogDescription className="break-words min-w-0">
              将删除 {deleteTarget?.suffix}。已存在的路由不会自动删除，但用户将无法再领取该后缀下的新域名。
            </AlertDialogDescription>
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void removeRow()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
