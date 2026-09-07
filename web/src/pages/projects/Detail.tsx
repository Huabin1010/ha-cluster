import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useDelete, useGetIdentity, useOne, useUpdate } from "@refinedev/core";
import { api, friendlyError, type AuthUser } from "../../providers";
import { copyText, formatBudget, formatBytes, formatCpuMilli, formatTime } from "./format";
import { canManageProject, type Project, type ProjectUsage } from "./types";
import { ProjectFormDialog } from "./FormDialog";
import { ProjectDeleteDialog } from "./DeleteDialog";
import { readCurrentProject, writeCurrentProject } from "../../lib/current-project";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Field } from "../../components/ui/field";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Separator } from "../../components/ui/separator";
import { Loading } from "../../ui";

function parseBudgetInput(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return 0;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

export function ProjectDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: me } = useGetIdentity<AuthUser>();
  const { data, isLoading, isError, error, refetch } = useOne<Project>({
    resource: "projects",
    id,
  });
  const { mutate: patch, isLoading: savingBudget } = useUpdate();
  const { mutate: patchMeta, isLoading: savingMeta } = useUpdate();
  const { mutate: remove, isLoading: removing } = useDelete();

  const [usage, setUsage] = useState<ProjectUsage | null>(null);
  const [usageErr, setUsageErr] = useState("");
  const [budgetCpu, setBudgetCpu] = useState("");
  const [budgetMem, setBudgetMem] = useState("");
  const [budgetDisk, setBudgetDisk] = useState("");
  const [formErr, setFormErr] = useState("");
  const [formOk, setFormOk] = useState("");
  const [copied, setCopied] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editErr, setEditErr] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const project = data?.data;

  useEffect(() => {
    if (project?.id) writeCurrentProject(project.id);
  }, [project?.id]);

  useEffect(() => {
    if (!project) return;
    setBudgetCpu(String(project.budget_cpu_milli ?? 0));
    setBudgetMem(String(project.budget_mem_bytes ?? 0));
    setBudgetDisk(String(project.budget_disk_bytes ?? 0));
  }, [project]);

  const loadUsage = useCallback(async () => {
    if (!id) return;
    setUsageErr("");
    try {
      const u = await api<ProjectUsage>(`/projects/${id}/usage`);
      setUsage(u);
    } catch (e) {
      setUsageErr(friendlyError(e));
    }
  }, [id]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  async function onCopyId() {
    if (!project) return;
    const ok = await copyText(project.id);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  function onSaveMeta(name: string, slug: string) {
    setEditErr("");
    patchMeta(
      {
        resource: "projects",
        id,
        values: { name, slug },
        successNotification: { message: "项目已保存", type: "success" },
        errorNotification: false,
      },
      {
        onSuccess: () => {
          setEditOpen(false);
          void refetch();
        },
        onError: (err) => {
          const raw = err instanceof Error ? err.message : String(err);
          if (raw === "conflict" || raw.includes("conflict")) {
            setEditErr("slug 已被占用，请换一个");
            return;
          }
          setEditErr(friendlyError(err));
        },
      },
    );
  }

  function confirmDelete() {
    setDeleteOpen(false);
    setFormErr("");
    remove(
      {
        resource: "projects",
        id,
        successNotification: { message: "项目已删除", type: "success" },
        errorNotification: false,
      },
      {
        onSuccess: () => {
          if (readCurrentProject() === id) writeCurrentProject("");
          navigate("/projects");
        },
        onError: (err) => setFormErr(friendlyError(err)),
      },
    );
  }

  function onSaveBudget(e: FormEvent) {
    e.preventDefault();
    setFormErr("");
    setFormOk("");
    const cpu = parseBudgetInput(budgetCpu);
    const mem = parseBudgetInput(budgetMem);
    const disk = parseBudgetInput(budgetDisk);
    if (cpu == null || mem == null || disk == null) {
      setFormErr("预算须为非负整数；填 0 表示不限制");
      return;
    }
    patch(
      {
        resource: "projects",
        id,
        values: {
          budget_cpu_milli: cpu,
          budget_mem_bytes: mem,
          budget_disk_bytes: disk,
        },
      },
      {
        onSuccess: () => {
          setFormOk("预算已保存");
          void refetch();
          void loadUsage();
        },
        onError: (err) => setFormErr(friendlyError(err)),
      },
    );
  }

  if (isLoading) {
    return (
      <section>
        <Loading label="加载项目…" />
      </section>
    );
  }

  if (isError || !project) {
    return (
      <section className="grid gap-3">
        <Alert variant="destructive">
          <AlertDescription>{friendlyError(error) || "项目不存在或无权访问"}</AlertDescription>
        </Alert>
        <Button variant="link" asChild>
          <Link to="/projects">← 返回项目列表</Link>
        </Button>
      </section>
    );
  }

  return (
    <section className="project-detail grid gap-6">
      <Button variant="link" className="h-auto w-fit p-0" asChild>
        <Link to="/projects">← 项目</Link>
      </Button>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="m-0 text-xl font-semibold">{project.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            slug <span className="mono font-mono">{project.slug}</span>
            {project.created_at && <> · 创建于 {formatTime(project.created_at)}</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" data-testid="project-copy-id" onClick={onCopyId}>
            {copied ? "已复制 id" : "复制 id"}
          </Button>
          {canManageProject(project.my_role, me?.platform_role, project.owner_id, me?.id) && (
            <>
              <Button
                type="button"
                variant="outline"
                data-testid="project-edit"
                onClick={() => {
                  setEditErr("");
                  setEditOpen(true);
                }}
              >
                编辑
              </Button>
              <Button type="button" variant="destructive" data-testid="project-delete" onClick={() => setDeleteOpen(true)} disabled={removing}>
                删除
              </Button>
            </>
          )}
          <Button variant="outline" asChild>
            <Link data-testid="project-goto-members" to={`/projects/${encodeURIComponent(project.id)}/members`}>
              成员 / 邀请
            </Link>
          </Button>
          <Button asChild>
            <Link data-testid="project-goto-workspaces" to={`/workspaces?project_id=${encodeURIComponent(project.id)}`}>
              管理服务器
            </Link>
          </Button>
        </div>
      </header>

      <p className="mono m-0 font-mono text-xs text-muted-foreground" data-testid="project-id">
        {project.id}
      </p>

      <div>
        <h3 className="mb-3 text-base font-semibold">用量</h3>
        {usageErr && (
          <Alert variant="destructive">
            <AlertDescription>{usageErr}</AlertDescription>
          </Alert>
        )}
        {usage ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3" data-testid="project-usage">
            <Card>
              <CardHeader className="p-4">
                <CardDescription>服务器</CardDescription>
                <CardTitle>{usage.workspaces}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="p-4">
                <CardDescription>CPU</CardDescription>
                <CardTitle>{formatCpuMilli(usage.cpu_milli)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="p-4">
                <CardDescription>内存</CardDescription>
                <CardTitle>{formatBytes(usage.mem_bytes)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="p-4">
                <CardDescription>磁盘</CardDescription>
                <CardTitle>{formatBytes(usage.disk_bytes)}</CardTitle>
              </CardHeader>
            </Card>
          </div>
        ) : (
          !usageErr && <p className="text-sm text-muted-foreground">加载用量…</p>
        )}
        <p className="mt-3 text-sm text-muted-foreground">
          当前预算：CPU {formatBudget(project.budget_cpu_milli, "cpu")} · 内存{" "}
          {formatBudget(project.budget_mem_bytes, "bytes")} · 磁盘{" "}
          {formatBudget(project.budget_disk_bytes, "bytes")}
        </p>
      </div>

      <Separator />

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>编辑预算</CardTitle>
          <CardDescription>
            仅 owner 可改。填 <strong>0</strong> 表示不限制。单位：milli-CPU（1000=1 核）、字节（内存/磁盘）。
            例：512Mi ≈ 536870912，10Gi ≈ 10737418240。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3" onSubmit={onSaveBudget}>
            <Field
              label={
                <>
                  budget_cpu_milli
                  {budgetCpu.trim() && parseBudgetInput(budgetCpu) !== null && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      (≈ {formatBudget(parseBudgetInput(budgetCpu)!, "cpu")})
                    </span>
                  )}
                </>
              }
            >
              <Input inputMode="numeric" value={budgetCpu} onChange={(e) => setBudgetCpu(e.target.value)} data-testid="budget-cpu" />
            </Field>
            <Field
              label={
                <>
                  budget_mem_bytes
                  {budgetMem.trim() && parseBudgetInput(budgetMem) !== null && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      (≈ {formatBudget(parseBudgetInput(budgetMem)!, "bytes")})
                    </span>
                  )}
                </>
              }
            >
              <Input inputMode="numeric" value={budgetMem} onChange={(e) => setBudgetMem(e.target.value)} data-testid="budget-mem" />
            </Field>
            <Field
              label={
                <>
                  budget_disk_bytes
                  {budgetDisk.trim() && parseBudgetInput(budgetDisk) !== null && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      (≈ {formatBudget(parseBudgetInput(budgetDisk)!, "bytes")})
                    </span>
                  )}
                </>
              }
            >
              <Input inputMode="numeric" value={budgetDisk} onChange={(e) => setBudgetDisk(e.target.value)} data-testid="budget-disk" />
            </Field>
            <Button type="submit" disabled={savingBudget} data-testid="budget-save">
              {savingBudget ? "保存中…" : "保存预算"}
            </Button>
          </form>
          {formErr && (
            <Alert variant="destructive" className="mt-3" data-testid="project-error">
              <AlertDescription>{formErr}</AlertDescription>
            </Alert>
          )}
          {formOk && <p className="ok mt-3 text-sm">{formOk}</p>}
        </CardContent>
      </Card>
      <ProjectFormDialog
        open={editOpen}
        onOpenChange={(v) => {
          setEditOpen(v);
          if (!v) setEditErr("");
        }}
        mode="edit"
        initial={{ name: project.name, slug: project.slug }}
        submitting={savingMeta}
        error={editErr}
        onSubmit={onSaveMeta}
      />
      <ProjectDeleteDialog
        open={deleteOpen}
        name={project.name}
        onOpenChange={setDeleteOpen}
        onConfirm={confirmDelete}
      />
    </section>
  );
}
