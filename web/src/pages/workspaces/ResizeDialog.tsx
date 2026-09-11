import { FormEvent, useEffect, useState } from "react";
import { api, friendlyError } from "@/providers";
import { formatPlanSpec, GiB, hasPendingResize, Workspace, workspaceSpec } from "./types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

type Props = {
  ws: Workspace;
  disabled?: boolean;
  onSubmitted: () => void;
  onError: (msg: string) => void;
};

export function ResizeDialog({ ws, disabled, onSubmitted, onError }: Props) {
  const spec = workspaceSpec(ws);
  const [open, setOpen] = useState(false);
  const [cpuCores, setCpuCores] = useState("2");
  const [memGi, setMemGi] = useState("2");
  const [diskGi, setDiskGi] = useState("5");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !spec) return;
    setCpuCores(String(spec.cpu_milli / 1000));
    setMemGi(String(spec.mem_bytes / GiB));
    setDiskGi(String(spec.disk_bytes / GiB));
    setErr("");
  }, [open, spec]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    const cpu = Number(cpuCores);
    const mem = Number(memGi);
    const disk = Number(diskGi);
    if (!Number.isFinite(cpu) || !Number.isFinite(mem) || !Number.isFinite(disk) || cpu <= 0 || mem <= 0 || disk <= 0) {
      setErr("请填写有效的 CPU / 内存 / 磁盘");
      return;
    }
    setBusy(true);
    try {
      await api(`/workspaces/${ws.id}/resize`, {
        method: "POST",
        body: JSON.stringify({
          cpu_milli: Math.round(cpu * 1000),
          mem_bytes: Math.round(mem * GiB),
          disk_bytes: Math.round(disk * GiB),
        }),
      });
      setOpen(false);
      onSubmitted();
    } catch (e) {
      const msg = friendlyError(e);
      setErr(msg);
      onError(msg);
    } finally {
      setBusy(false);
    }
  }

  if (hasPendingResize(ws) || !spec) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="compact" data-testid="ws-resize" disabled={disabled} className="h-7 text-xs px-2">
          申请扩容
        </Button>
      </DialogTrigger>
      <DialogContent size="lg" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>申请服务器扩容</DialogTitle>
          <DialogDescription>
            当前规格: {formatPlanSpec(spec)}。只支持上调；不提供磁盘缩容，磁盘不能小于当前值。提交后需管理员审批。
          </DialogDescription>
        </DialogHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
          <DialogBody className="grid gap-4 overflow-x-hidden overflow-y-auto max-w-full">
            <Field label="CPU（核）">
              <Input data-testid="ws-resize-cpu" inputMode="decimal" value={cpuCores} onChange={(e) => setCpuCores(e.target.value)} />
            </Field>
            <Field label="内存（GiB）">
              <Input data-testid="ws-resize-mem" inputMode="decimal" value={memGi} onChange={(e) => setMemGi(e.target.value)} />
            </Field>
            <Field label="磁盘（GiB，只可加大）">
              <Input data-testid="ws-resize-disk" inputMode="decimal" value={diskGi} onChange={(e) => setDiskGi(e.target.value)} />
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
            <Button data-testid="ws-resize-submit" disabled={busy} type="submit">
              {busy ? "提交中…" : "提交扩容申请"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
