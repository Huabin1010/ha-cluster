import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, friendlyError } from "@/providers";
import {
  classifyResizePreview,
  CUSTOM_PLAN,
  defaultResizePlan,
  formatCpuCores,
  formatDiskSize,
  formatMemSize,
  formatPlanSpec,
  formatSpecNumber,
  GiB,
  hasPendingResize,
  PLAN_CATALOG,
  PlanItem,
  resizePreviewValid,
  Workspace,
  workspaceSpec,
  type ResizeDeltaKind,
  type ResizePreview,
} from "./types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectBox } from "@/components/ui/select";
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
  canApprove?: boolean;
  onSubmitted: (applied: boolean) => void;
  onError: (msg: string) => void;
};

const fieldControlClass =
  "border-(--line-strong) bg-(--input-bg) shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]";

function parseTarget(cpuCores: string, memGi: string, diskGi: string): PlanItem | null {
  const cpu = Number(cpuCores);
  const mem = Number(memGi);
  const disk = Number(diskGi);
  if (!Number.isFinite(cpu) || !Number.isFinite(mem) || !Number.isFinite(disk) || cpu <= 0 || mem <= 0 || disk <= 0) {
    return null;
  }
  return {
    name: CUSTOM_PLAN,
    cpu_milli: Math.round(cpu * 1000),
    mem_bytes: Math.round(mem * GiB),
    disk_bytes: Math.round(disk * GiB),
  };
}

function previewMessage(kind: ResizePreview["kind"], canApprove: boolean): string {
  switch (kind) {
    case "upgrade":
      return canApprove ? "本次为升配。确认后立即生效，无需再走审批。" : "本次为升配。确认后将提交申请，由管理员审批。";
    case "downgrade":
      return "本次为降配。降低配置需提交申请，审批通过后才会生效。";
    case "unchanged":
      return "规格未变化，无需提交。";
    case "mixed":
      return "不能同时升配一项并降配另一项，请调整后再提交。";
    case "disk_shrink":
      return "不支持缩小磁盘，磁盘不能小于当前值。";
  }
}

function dimTag(delta: ResizeDeltaKind): { text: string; className: string } {
  if (delta === "up") return { text: "升配", className: "text-emerald-400" };
  if (delta === "down") return { text: "降配", className: "text-amber-400" };
  return { text: "不变", className: "text-muted-foreground" };
}

function DeltaRow({
  label,
  from,
  to,
  delta,
}: {
  label: string;
  from: string;
  to: string;
  delta: ResizeDeltaKind;
}) {
  const tag = dimTag(delta);
  return (
    <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_1rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium truncate">{from}</span>
      <span className="text-muted-foreground text-center">→</span>
      <span className="font-medium truncate">{to}</span>
      <span className={`text-right text-xs ${tag.className}`}>{tag.text}</span>
    </div>
  );
}

export function ResizeDialog({ ws, disabled, canApprove, onSubmitted, onError }: Props) {
  const spec = useMemo(() => workspaceSpec(ws), [ws.plan, ws.cpu_milli, ws.mem_bytes, ws.disk_bytes]);
  const [open, setOpen] = useState(false);
  const [plans, setPlans] = useState<PlanItem[]>(PLAN_CATALOG);
  const [selectedPlan, setSelectedPlan] = useState<string>(CUSTOM_PLAN);
  const [cpuCores, setCpuCores] = useState("2");
  const [memGi, setMemGi] = useState("2");
  const [diskGi, setDiskGi] = useState("5");
  const [step, setStep] = useState<"form" | "preview">("form");
  const [target, setTarget] = useState<PlanItem | null>(null);
  const [preview, setPreview] = useState<ResizePreview | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<PlanItem[]>("/plans")
      .then((list) => {
        if (!cancelled && Array.isArray(list) && list.length > 0) setPlans(list);
      })
      .catch(() => {
        /* fallback to PLAN_CATALOG */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function resetForm() {
    if (!spec) return;
    setCpuCores(formatSpecNumber(spec.cpu_milli / 1000));
    setMemGi(formatSpecNumber(spec.mem_bytes / GiB));
    setDiskGi(formatSpecNumber(spec.disk_bytes / GiB));
    setSelectedPlan(defaultResizePlan(plans, spec));
    setStep("form");
    setTarget(null);
    setPreview(null);
    setErr("");
  }

  function fillFromPlan(name: string) {
    if (!spec) return;
    setSelectedPlan(name);
    if (name === CUSTOM_PLAN) return;
    const plan = plans.find((p) => p.name === name);
    if (!plan) return;
    setCpuCores(formatSpecNumber(plan.cpu_milli / 1000));
    setMemGi(formatSpecNumber(plan.mem_bytes / GiB));
    setDiskGi(formatSpecNumber(Math.max(plan.disk_bytes, spec.disk_bytes) / GiB));
  }

  function onCustomCpu(value: string) {
    setSelectedPlan(CUSTOM_PLAN);
    setCpuCores(value);
  }

  function onCustomMem(value: string) {
    setSelectedPlan(CUSTOM_PLAN);
    setMemGi(value);
  }

  const minDiskGi = spec ? spec.disk_bytes / GiB : 1;
  const minDiskLabel = formatSpecNumber(minDiskGi);

  function restoreDiskIfShrunk(raw: string): { value: string; shrunk: boolean } {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < minDiskGi) {
      return { value: minDiskLabel, shrunk: true };
    }
    return { value: raw, shrunk: false };
  }

  function onCustomDisk(value: string) {
    setSelectedPlan(CUSTOM_PLAN);
    setDiskGi(value);
    const n = Number(value);
    if (Number.isFinite(n) && n >= minDiskGi) setErr("");
  }

  function onDiskBlur() {
    const next = restoreDiskIfShrunk(diskGi);
    if (next.shrunk) {
      setDiskGi(next.value);
      setErr("磁盘不能缩小，已恢复为当前容量");
    }
  }

  function onPreviewSubmit(e: FormEvent) {
    e.preventDefault();
    if (!spec) return;
    const disk = restoreDiskIfShrunk(diskGi);
    if (disk.shrunk) {
      setDiskGi(disk.value);
      setErr("磁盘不能缩小，已恢复为当前容量");
      return;
    }
    setErr("");
    const next = parseTarget(cpuCores, memGi, disk.value);
    if (!next) {
      setErr("请填写有效的 CPU / 内存 / 磁盘");
      return;
    }
    if (next.disk_bytes < spec.disk_bytes) {
      setDiskGi(minDiskLabel);
      setErr("磁盘不能缩小，已恢复为当前容量");
      return;
    }
    const result = classifyResizePreview(spec, next);
    setTarget(next);
    setPreview(result);
    setStep("preview");
  }

  async function onConfirm() {
    if (!spec || !target || !preview || !resizePreviewValid(preview.kind)) return;
    setErr("");
    setBusy(true);
    try {
      const out = await api<Workspace>(`/workspaces/${ws.id}/resize`, {
        method: "POST",
        body: JSON.stringify({
          cpu_milli: target.cpu_milli,
          mem_bytes: target.mem_bytes,
          disk_bytes: target.disk_bytes,
        }),
      });
      setOpen(false);
      onSubmitted(!hasPendingResize(out));
    } catch (e) {
      const msg = friendlyError(e);
      setErr(msg);
      onError(msg);
    } finally {
      setBusy(false);
    }
  }

  if (hasPendingResize(ws) || !spec) return null;

  const planOptions = [
    ...plans.map((p) => ({
      value: p.name,
      label: `${p.name}（${formatPlanSpec(p)}）`,
    })),
    { value: CUSTOM_PLAN, label: "自定义" },
  ];
  const canConfirm = preview != null && resizePreviewValid(preview.kind);
  const applyNow = Boolean(canApprove) && preview?.kind === "upgrade";
  const diskBelowMin = Number.isFinite(Number(diskGi)) ? Number(diskGi) < minDiskGi : true;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="compact" data-testid="ws-resize" disabled={disabled} className="h-7 text-xs px-2">
          {canApprove ? "升降配" : "申请扩容"}
        </Button>
      </DialogTrigger>
      <DialogContent size="lg" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{step === "preview" ? "确认本次升降配" : canApprove ? "调整服务器规格" : "申请服务器扩容"}</DialogTitle>
          <DialogDescription>
            {step === "preview"
              ? `当前规格 ${formatPlanSpec(spec)}。请核对下方变更后再${applyNow ? "执行" : "提交"}。`
              : `当前规格：${formatPlanSpec(spec)}。默认选择套餐规格，也可自行填写。磁盘不能小于当前值；CPU / 内存可升可降，但不能一项升一项降。${
                  canApprove ? "升配确认后立即生效；降配需审批后才会执行。" : "提交后需管理员审批。"
                }`}
          </DialogDescription>
        </DialogHeader>
        {step === "form" ? (
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={onPreviewSubmit}>
            <DialogBody className="grid gap-4 overflow-x-hidden overflow-y-auto max-w-full">
              <Field label="目标规格">
                <SelectBox
                  testId="ws-resize-plan"
                  value={selectedPlan}
                  onValueChange={fillFromPlan}
                  className={`w-full ${fieldControlClass}`}
                  options={planOptions}
                />
              </Field>
              <Field label="CPU（核）">
                <Input
                  data-testid="ws-resize-cpu"
                  className={fieldControlClass}
                  inputMode="decimal"
                  value={cpuCores}
                  onChange={(e) => onCustomCpu(e.target.value)}
                />
              </Field>
              <Field label="内存（GiB）">
                <Input
                  data-testid="ws-resize-mem"
                  className={fieldControlClass}
                  inputMode="decimal"
                  value={memGi}
                  onChange={(e) => onCustomMem(e.target.value)}
                />
              </Field>
              <Field label={`磁盘（GiB，不可小于 ${minDiskLabel}）`}>
                <Input
                  data-testid="ws-resize-disk"
                  className={fieldControlClass}
                  type="number"
                  inputMode="decimal"
                  min={minDiskLabel}
                  step="any"
                  error={diskBelowMin}
                  value={diskGi}
                  onChange={(e) => onCustomDisk(e.target.value)}
                  onBlur={onDiskBlur}
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
              <Button data-testid="ws-resize-submit" type="submit" disabled={diskBelowMin}>
                预览升降配
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <DialogBody className="grid gap-4 overflow-x-hidden overflow-y-auto max-w-full">
              {target && preview && (
                <div data-testid="ws-resize-preview" className="grid gap-3 rounded-lg border border-(--line-strong) bg-(--input-bg) p-4">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">变更类型</span>
                    <span
                      className={
                        preview.kind === "upgrade"
                          ? "font-medium text-emerald-400"
                          : preview.kind === "downgrade"
                            ? "font-medium text-amber-400"
                            : "font-medium text-foreground"
                      }
                    >
                      {preview.kind === "upgrade" ? "升配" : preview.kind === "downgrade" ? "降配" : "无法提交"}
                    </span>
                  </div>
                  <DeltaRow label="CPU" from={formatCpuCores(spec.cpu_milli)} to={formatCpuCores(target.cpu_milli)} delta={preview.cpu} />
                  <DeltaRow label="内存" from={formatMemSize(spec.mem_bytes)} to={formatMemSize(target.mem_bytes)} delta={preview.mem} />
                  <DeltaRow label="磁盘" from={formatDiskSize(spec.disk_bytes)} to={formatDiskSize(target.disk_bytes)} delta={preview.disk} />
                  <p className="m-0 text-xs text-muted-foreground">
                    {formatPlanSpec(spec)} → {formatPlanSpec(target)}
                  </p>
                </div>
              )}
              {preview && (
                <Alert variant={canConfirm ? "info" : "destructive"}>
                  <AlertDescription>{previewMessage(preview.kind, Boolean(canApprove))}</AlertDescription>
                </Alert>
              )}
              {err && (
                <Alert variant="destructive">
                  <AlertDescription>{err}</AlertDescription>
                </Alert>
              )}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStep("form")}>
                返回修改
              </Button>
              <Button data-testid="ws-resize-confirm" disabled={busy || !canConfirm} type="button" onClick={() => void onConfirm()}>
                {busy ? (applyNow ? "执行中…" : "提交中…") : applyNow ? "确认执行" : "确认提交"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
