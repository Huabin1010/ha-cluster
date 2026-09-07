import { FormEvent, useState } from "react";
import { Plus } from "lucide-react";
import { useCreate, useDelete, useList } from "@refinedev/core";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Field } from "../../components/ui/field";
import { Alert, AlertDescription } from "../../components/ui/alert";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";
import { PageFrame } from "../../components/ui/page-frame";
import { Paginator } from "../../components/ui/pagination";
import { friendlyError } from "../../providers";
import { Empty, PageBody, PageHeader } from "../../ui";
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
} from "../../components/ui/alert-dialog";
import { useClientPager } from "../../lib/use-client-pager";

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
        <PageHeader
          title="SSH 公钥"
          description="添加的公钥会注入到你申请并通过审批的隔离环境，并用于跳板 SSH 登录。"
          actions={
            <Dialog
              open={open}
              onOpenChange={(v) => {
                setOpen(v);
                if (!v) reset();
              }}
            >
              <DialogTrigger asChild>
                <Button type="button" data-testid="keys-add-open">
                  <Plus className="h-4 w-4" />
                  添加公钥
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>添加公钥</DialogTitle>
                  <DialogDescription>粘贴 SSH 公钥，名称可选。</DialogDescription>
                </DialogHeader>
                <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
                  <DialogBody className="grid gap-4">
                    <Field label="名称">
                      <Input
                        data-testid="keys-name"
                        placeholder="例如：MacBook"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="off"
                      />
                    </Field>
                    <Field label="公钥">
                      <Textarea
                        data-testid="keys-pubkey"
                        placeholder="ssh-ed25519 AAAA… comment"
                        value={publicKey}
                        onChange={(e) => setPublicKey(e.target.value)}
                        rows={3}
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
                      {submitting ? "添加中…" : "添加公钥"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          }
        />
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
      <PageBody loading={isLoading}>
        {keys.length === 0 ? (
          <Empty text="还没有公钥，添加一条以便 SSH 登录。" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>fingerprint</TableHead>
                <TableHead>添加时间</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pager.slice.map((k) => (
                <TableRow key={k.id} data-testid="keys-row">
                  <TableCell>{k.name || "—"}</TableCell>
                  <TableCell className="mono font-mono text-xs">{k.fingerprint}</TableCell>
                  <TableCell>{fmtTime(k.created_at)}</TableCell>
                  <TableCell>
                    <Button data-testid="keys-remove" variant="ghost" type="button" onClick={() => void remove(k.id)}>
                      删除
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </PageBody>
    </PageFrame>
    <AlertDialog open={!!removeId} onOpenChange={(v) => !v && setRemoveId(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除公钥</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogBody>
          <AlertDialogDescription>确定删除此公钥？</AlertDialogDescription>
        </AlertDialogBody>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="confirm-cancel">取消</AlertDialogCancel>
          <AlertDialogAction data-testid="confirm-ok" onClick={confirmRemove}>
            确定
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
