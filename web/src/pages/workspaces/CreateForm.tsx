import { FormEvent, MutableRefObject, ReactNode, useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api, friendlyError, isInsufficientCapacity } from "@/providers";
import { formatUsageHint } from "./format";
import { ARCHES, canApproveRole, formatPlanSpec, PlanItem, PLANS, PLAN_SPECS, ProjectOption, ProjectUsage } from "./types";
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
  projects: ProjectOption[];
  initialProjectId: string;
  reloadUsageRef?: MutableRefObject<(() => void) | undefined>;
  usageTick?: number;
  onCreated: () => void;
  onError: (msg: string, insufficient?: boolean) => void;
  trigger?: ReactNode;
  canApprove?: boolean;
  platformRole?: string;
};

export function CreateForm({
  projects,
  initialProjectId,
  reloadUsageRef,
  usageTick = 0,
  onCreated,
  onError,
  trigger,
  canApprove: canApproveProp = false,
  platformRole,
}: Props) {
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [advancedId, setAdvancedId] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [plan, setPlan] = useState<string>("nano");
  const [arch, setArch] = useState<string>("amd64");
  const [visibility, setVisibility] = useState<"shared" | "private">("shared");
  const [name, setName] = useState("");
  const [usageHint, setUsageHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [availablePlans, setAvailablePlans] = useState<PlanItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    api<PlanItem[]>("/plans")
      .then((list) => {
        if (!cancelled && Array.isArray(list) && list.length > 0) {
          setAvailablePlans(list);
        }
      })
      .catch(() => {
        /* fallback to static PLANS */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (initialProjectId) setProjectId(initialProjectId);
  }, [initialProjectId]);

  const effectiveProjectId = (showAdvanced && advancedId.trim() ? advancedId.trim() : projectId).trim();
  const formProject = projects.find((p) => p.id === effectiveProjectId);
  const canApprove = canApproveRole(formProject?.my_role, platformRole) || canApproveProp;

  const loadUsage = useCallback(async () => {
    if (!effectiveProjectId) {
      setUsageHint("");
      return;
    }
    try {
      const u = await api<ProjectUsage>(`/projects/${effectiveProjectId}/usage`);
      setUsageHint(formatUsageHint(u));
    } catch {
      setUsageHint("");
    }
  }, [effectiveProjectId]);

  useEffect(() => {
    if (reloadUsageRef) {
      (reloadUsageRef as any).current = loadUsage;
    }
  }, [reloadUsageRef, loadUsage]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage, usageTick, open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!effectiveProjectId) {
      setFormErr("请选择项目");
      onError("请选择项目");
      return;
    }
    setBusy(true);
    setFormErr("");
    onError("");
    try {
      const wsName = name.trim() || `${plan}-${arch}`;
      await api(`/projects/${effectiveProjectId}/workspaces`, {
        method: "POST",
        body: JSON.stringify({
          name: wsName,
          plan,
          arch,
          visibility,
        }),
      });
      setName("");
      void loadUsage();
      setOpen(false);
      onCreated();
    } catch (err) {
      const insufficient = isInsufficientCapacity(err);
      const msg = friendlyError(err);
      setFormErr(msg);
      onError(msg, insufficient);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" data-testid="ws-create">
            <Plus className="h-4 w-4" />
            {canApprove ? "开通服务器" : "申请服务器"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent size="lg" className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{canApprove ? "开通服务器" : "申请服务器"}</DialogTitle>
          <DialogDescription>
            {canApprove
              ? "选择套餐后开通隔离机器。示例规格 2c2g = 2 核 / 2GiB 内存 / 5GiB 盘。停止后仍占配额。"
              : "提交申请后由项目管理员审批。通过后才会占用配额并创建机器。开通后可再申请扩容（硬盘不能缩小）。"}
          </DialogDescription>
        </DialogHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
          <DialogBody className="grid gap-4">
            <Field label="项目">
              <SelectBox
                testId="ws-project-select"
                value={projectId}
                onValueChange={setProjectId}
                disabled={showAdvanced}
                placeholder="选择项目…"
                options={projects.map((p) => ({ value: p.id, label: `${p.name} (${p.slug})` }))}
              />
            </Field>
            <Field label="名称">
              <Input
                data-testid="ws-name-input"
                placeholder="可选，默认 plan-arch"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="套餐">
                <SelectBox
                  testId="ws-plan-select"
                  value={plan}
                  onValueChange={setPlan}
                  options={
                    availablePlans.length > 0
                      ? availablePlans.map((p) => ({
                          value: p.name,
                          label: `${p.name}${formatPlanSpec(p) ? ` (${formatPlanSpec(p)})` : ""}`,
                        }))
                      : PLANS.map((p) => ({
                          value: p,
                          label: `${p}${PLAN_SPECS[p] ? ` (${PLAN_SPECS[p]})` : ""}`,
                        }))
                  }
                />
              </Field>
              <Field label="架构">
                <SelectBox
                  testId="ws-arch-select"
                  value={arch}
                  onValueChange={setArch}
                  options={ARCHES.map((a) => ({ value: a, label: a }))}
                />
              </Field>
            </div>

            <Field label="可见性">
              <SelectBox
                testId="ws-visibility-select"
                value={visibility}
                onValueChange={(v) => setVisibility(v as "shared" | "private")}
                options={[
                  { value: "shared", label: "shared（项目成员可 SSH）" },
                  { value: "private", label: "private（仅 owner）" },
                ]}
              />
            </Field>

            <div className="grid gap-2">
              <Button type="button" variant="ghost" className="w-fit px-0 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? "收起高级选项" : "高级选项：手动粘贴 project uuid"}
              </Button>
              {showAdvanced && (
                <Input
                  className="mono font-mono text-xs"
                  placeholder="project uuid"
                  value={advancedId}
                  onChange={(e) => setAdvancedId(e.target.value)}
                  aria-label="project uuid"
                />
              )}
            </div>

            {usageHint && (
              <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground border border-border/60 leading-relaxed break-words">
                {usageHint}
              </div>
            )}
            {formErr && (
              <Alert variant="destructive">
                <AlertDescription>{formErr}</AlertDescription>
              </Alert>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button data-testid="ws-submit" disabled={busy} type="submit">
              {busy ? "创建中…" : canApprove ? "开通服务器" : "提交申请"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
