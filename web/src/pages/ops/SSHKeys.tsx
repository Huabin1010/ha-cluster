import { FormEvent, useState } from "react";
import { Check, Clock, Copy, Fingerprint, KeyRound, Plus, Shield, SlidersHorizontal, Trash2 } from "lucide-react";
import { useCreate, useDelete, useList } from "@refinedev/core";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { PageFrame } from "@/components/ui/page-frame";
import { PageHeading } from "@/components/ui/page-heading";
import { Paginator } from "@/components/ui/pagination";
import { Elevated } from "@/lib/elevated";
import { Hint } from "@/components/ui/tooltip";
import { friendlyError } from "@/providers";
import { Loading } from "@/ui";
import { copyText } from "@/ui/format";
import { fmtTime } from "./format";
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
import { useClientPager } from "@/lib/use-client-pager";

type SSHKey = {
  id: string;
  name: string;
  public_key: string;
  fingerprint: string;
  created_at: string;
};

export function SSHKeysPage() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [err, setErr] = useState("");
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data, isLoading } = useList<SSHKey>({
    resource: "ssh-keys",
    pagination: { mode: "off" },
    errorNotification: false,
  });
  const { mutate: create, isLoading: submitting } = useCreate();
  const { mutate: removeKey } = useDelete();
  const keys = data?.data ?? [];
  const pager = useClientPager(keys);

  function reset() {
    setName("");
    setPublicKey("");
    setErr("");
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    create(
      {
        resource: "ssh-keys",
        values: { name: name.trim() || "default", public_key: publicKey.trim() },
        successNotification: { message: "公钥已添加", type: "success" },
        errorNotification: false,
      },
      {
        onSuccess: () => {
          reset();
          setOpen(false);
        },
        onError: (e) => setErr(friendlyError(e)),
      },
    );
  }

  async function copyKey(id: string, text: string) {
    const ok = await copyText(text);
    if (!ok) {
      setErr("复制失败，请手动选择");
      return;
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
  }

  function remove(id: string) {
    setRemoveId(id);
  }

  function confirmRemove() {
    if (!removeId) return;
    const id = removeId;
    setRemoveId(null);
    setErr("");
    removeKey(
      {
        resource: "ssh-keys",
        id,
        successNotification: { message: "公钥已删除", type: "success" },
        errorNotification: false,
      },
      {
        onError: (e) => setErr(friendlyError(e)),
      },
    );
  }

  return (
    <>
      <PageFrame
        header={
          <PageHeading
            icon={KeyRound}
            title="SSH 个人公钥"
            badges={
              <Badge variant="outline" className="inline-flex items-center whitespace-nowrap shrink-0 px-2 py-0.5 text-xs font-mono font-normal">
                {keys.length} 把公钥
              </Badge>
            }
            description="登记你的 SSH 身份公钥。添加后将自动注入你有权访问的所有隔离服务器，用于经由 Bastion 跳板机免密安全登录。"
            actions={
              <Dialog
                open={open}
                onOpenChange={(v) => {
                  setOpen(v);
                  if (!v) reset();
                }}
              >
                <DialogTrigger asChild>
                  <Button type="button" size="compact" data-testid="keys-add-open" className="h-8 px-3 text-xs gap-1.5 shrink-0">
                    <Plus className="size-3.5 shrink-0" />
                    添加公钥
                  </Button>
                </DialogTrigger>
                  <DialogContent size="lg" className="sm:max-w-xl">
                    <DialogHeader>
                      <DialogTitle>登记 SSH 公钥</DialogTitle>
                      <DialogDescription>
                        请粘贴本机公钥内容（通常为 <span className="font-mono text-xs">~/.ssh/id_ed25519.pub</span>）。
                      </DialogDescription>
                    </DialogHeader>
                    <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
                      <DialogBody className="grid gap-4 overflow-x-hidden overflow-y-auto max-w-full">
                        <Field label="公钥名称或备注">
                          <Input
                            data-testid="keys-name"
                            placeholder="例如：开发笔记本 MacBook Pro"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            autoComplete="off"
                          />
                        </Field>
                        <Field label="公钥内容 (id_ed25519.pub / id_rsa.pub)">
                          <Textarea
                            data-testid="keys-pubkey"
                            placeholder="ssh-ed25519 AAAA… user@machine"
                            value={publicKey}
                            onChange={(e) => setPublicKey(e.target.value)}
                            rows={4}
                            required
                          />
                        </Field>
                        {err && (
                          <Alert variant="destructive">
                            <AlertDescription>{err}</AlertDescription>
                          </Alert>
                        )}
                      </DialogBody>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                          取消
                        </Button>
                        <Button data-testid="keys-add" disabled={submitting || !publicKey.trim()} type="submit">
                          {submitting ? "添加中…" : "确认添加"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
            }
          >

            {/* 提示与指南条 */}
            <Elevated
              offset={1}
              shadowLevel={1}
              className="rounded-xl border border-border/80 bg-surface-1 p-3.5 shadow-surface-1 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between text-xs text-muted-foreground"
            >
              <div className="flex items-start gap-2 min-w-0">
                <Shield className="size-4 text-emerald-500 shrink-0 mt-0.5" />
                <span className="break-words min-w-0">
                  至少需要登记一把公钥才能通过平台 Bastion 跳板机接入。公钥变动将在 30 秒内向活跃容器热同步。
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge variant="ok" size="compact" className="font-mono font-normal">
                  Ed25519 推荐
                </Badge>
                <Badge
                  variant="outline"
                  size="compact"
                  className="font-mono font-normal text-foreground bg-(--token-box-bg)"
                >
                  RSA ≥ 2048
                </Badge>
              </div>
            </Elevated>
          </PageHeading>
        }
        footer={
          <Paginator
            page={pager.page}
            pageCount={pager.pageCount}
            pageSize={pager.pageSize}
            total={pager.total}
            onPageChange={pager.setPage}
            onPageSizeChange={pager.setPageSize}
          />
        }
      >
        {isLoading ? (
          <div className="py-12 text-center">
            <Loading label="加载个人公钥…" />
          </div>
        ) : keys.length === 0 ? (
          <div className="py-8 flex flex-col items-center justify-center">
            <Elevated
              offset={1}
              shadowLevel={2}
              className="rounded-2xl border border-border/80 bg-surface-1 p-8 shadow-surface-2 text-center max-w-md w-full flex flex-col items-center gap-3"
            >
              <div className="size-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20 shadow-xs">
                <KeyRound className="size-6" />
              </div>
              <div>
                <h3 className="m-0 text-base font-semibold text-foreground">尚未登记任何 SSH 公钥</h3>
                <p className="m-0 mt-1.5 text-xs text-muted-foreground leading-relaxed">
                  点击右上角「添加公钥」粘贴你计算机的公钥，即可开启服务器的 SSH 一键接入与终端直连。
                </p>
              </div>
            </Elevated>
          </div>
        ) : (
          <div className="w-full overflow-x-auto rounded-xl border border-border/80 bg-surface-1 shadow-surface-1">
            <Table className="min-w-[720px]">
              <TableHeader className="bg-surface-2/60 border-b border-border/70 select-none">
                <TableRow className="border-b border-border/60 hover:bg-transparent">
                  <TableHead className="py-2.5">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <KeyRound className="size-3.5 opacity-60 shrink-0" />
                      公钥名称 / 标识
                    </span>
                  </TableHead>
                  <TableHead className="w-[300px] py-2.5">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <Fingerprint className="size-3.5 opacity-60 shrink-0" />
                      SHA256 指纹 (Fingerprint)
                    </span>
                  </TableHead>
                  <TableHead className="w-[180px] py-2.5">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <Clock className="size-3.5 opacity-60 shrink-0" />
                      登记时间
                    </span>
                  </TableHead>
                  <TableHead stickyEnd className="w-[180px] text-right py-2.5 pr-4">
                    <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap w-full">
                      <SlidersHorizontal className="size-3.5 opacity-60 shrink-0" />
                      操作
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pager.slice.map((k) => (
                  <TableRow key={k.id} data-testid="keys-row">
                    <TableCell className="py-2.5 font-medium whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <KeyRound className="size-3.5 text-primary opacity-70 shrink-0" />
                        <span className="text-foreground">{k.name || "未命名公钥"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="py-2.5 whitespace-nowrap">
                      <Hint label={k.fingerprint}>
                        <span className="cursor-help inline-flex items-center rounded-md border border-border bg-(--token-box-bg) px-1.5 py-0.5 font-mono text-xs text-foreground">
                          {k.fingerprint.length > 32 ? `${k.fingerprint.slice(0, 32)}…` : k.fingerprint}
                        </span>
                      </Hint>
                    </TableCell>
                    <TableCell className="py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="size-3 opacity-50 shrink-0" />
                        {fmtTime(k.created_at)}
                      </span>
                    </TableCell>
                    <TableCell stickyEnd className="text-right py-2.5 w-[180px] pr-4">
                      <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                        <Button
                          type="button"
                          variant="ghost"
                          size="compact"
                          data-testid="keys-copy"
                          className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-7 text-xs px-2"
                          onClick={() => void copyKey(k.id, k.public_key)}
                        >
                          {copiedId === k.id ? (
                            <>
                              <Check className="size-3.5 text-emerald-500 shrink-0" />
                              已复制
                            </>
                          ) : (
                            <>
                              <Copy className="size-3.5 opacity-70 shrink-0" />
                              复制公钥
                            </>
                          )}
                        </Button>
                        <Button
                          data-testid="keys-remove"
                          variant="destructive"
                          size="compact"
                          type="button"
                          className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-7 text-xs px-2"
                          onClick={() => void remove(k.id)}
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

      <AlertDialog open={!!removeId} onOpenChange={(v) => !v && setRemoveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 SSH 公钥</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <AlertDialogDescription>
              确定删除此 SSH 公钥？删除后该公钥将从所有工作区宿主中移除，你将无法再使用此私钥登录服务器。
            </AlertDialogDescription>
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="confirm-cancel">取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" data-testid="confirm-ok" onClick={confirmRemove}>
              确定删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
