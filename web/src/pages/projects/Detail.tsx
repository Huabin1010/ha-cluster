import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useOne, useUpdate } from "@refinedev/core";
import { api, friendlyError } from "../../providers";
import { copyText, formatBudget, formatBytes, formatCpuMilli, formatTime } from "./format";
import type { Project, ProjectUsage } from "./types";

function parseBudgetInput(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return 0;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

export function ProjectDetailPage() {
  const { id = "" } = useParams();
  const { data, isLoading, isError, error, refetch } = useOne<Project>({
    resource: "projects",
    id,
  });
  const { mutate: patch, isLoading: saving } = useUpdate();

  const [usage, setUsage] = useState<ProjectUsage | null>(null);
  const [usageErr, setUsageErr] = useState("");
  const [budgetCpu, setBudgetCpu] = useState("");
  const [budgetMem, setBudgetMem] = useState("");
  const [budgetDisk, setBudgetDisk] = useState("");
  const [formErr, setFormErr] = useState("");
  const [formOk, setFormOk] = useState("");
  const [copied, setCopied] = useState(false);

  const project = data?.data;

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
        <p className="muted">加载项目…</p>
      </section>
    );
  }

  if (isError || !project) {
    return (
      <section>
        <p className="error">{friendlyError(error) || "项目不存在或无权访问"}</p>
        <Link to="/projects">← 返回项目列表</Link>
      </section>
    );
  }

  return (
    <section className="project-detail">
      <p>
        <Link to="/projects">← 项目</Link>
      </p>
      <header className="project-detail-head">
        <div>
          <h2>{project.name}</h2>
          <p className="muted">
            slug <span className="mono">{project.slug}</span>
            {project.created_at && <> · 创建于 {formatTime(project.created_at)}</>}
          </p>
        </div>
        <div className="row wrap">
          <button type="button" className="ghost" data-testid="project-copy-id" onClick={onCopyId}>
            {copied ? "已复制 id" : "复制 id"}
          </button>
          <Link data-testid="project-goto-members" to={`/projects/${encodeURIComponent(project.id)}/members`}>成员 / 邀请</Link>
          <Link data-testid="project-goto-workspaces" className="btn-link" to={`/workspaces?project_id=${encodeURIComponent(project.id)}`}>
            去创建 Workspace
          </Link>
        </div>
      </header>

      <div className="mono muted" data-testid="project-id">
        {project.id}
      </div>

      <h3>用量</h3>
      {usageErr && <p className="error">{usageErr}</p>}
      {usage ? (
        <div className="stat-grid" data-testid="project-usage">
          <div className="stat">
            <span className="muted">Workspace</span>
            <strong>{usage.workspaces}</strong>
          </div>
          <div className="stat">
            <span className="muted">CPU</span>
            <strong>{formatCpuMilli(usage.cpu_milli)}</strong>
          </div>
          <div className="stat">
            <span className="muted">内存</span>
            <strong>{formatBytes(usage.mem_bytes)}</strong>
          </div>
          <div className="stat">
            <span className="muted">磁盘</span>
            <strong>{formatBytes(usage.disk_bytes)}</strong>
          </div>
        </div>
      ) : (
        !usageErr && <p className="muted">加载用量…</p>
      )}
      <p className="muted">
        当前预算：CPU {formatBudget(project.budget_cpu_milli, "cpu")} · 内存{" "}
        {formatBudget(project.budget_mem_bytes, "bytes")} · 磁盘{" "}
        {formatBudget(project.budget_disk_bytes, "bytes")}
      </p>

      <h3>编辑预算</h3>
      <p className="muted">
        仅 owner 可改。填 <strong>0</strong> 表示不限制。单位：milli-CPU（1000=1 核）、字节（内存/磁盘）。
        例：512Mi ≈ 536870912，10Gi ≈ 10737418240。
      </p>
      <form className="budget-form" onSubmit={onSaveBudget}>
        <label>
          budget_cpu_milli
          <input
            inputMode="numeric"
            value={budgetCpu}
            onChange={(e) => setBudgetCpu(e.target.value)}
            data-testid="budget-cpu"
          />
        </label>
        <label>
          budget_mem_bytes
          <input
            inputMode="numeric"
            value={budgetMem}
            onChange={(e) => setBudgetMem(e.target.value)}
            data-testid="budget-mem"
          />
        </label>
        <label>
          budget_disk_bytes
          <input
            inputMode="numeric"
            value={budgetDisk}
            onChange={(e) => setBudgetDisk(e.target.value)}
            data-testid="budget-disk"
          />
        </label>
        <button type="submit" disabled={saving} data-testid="budget-save">
          {saving ? "保存中…" : "保存预算"}
        </button>
      </form>
      {formErr && (
        <p className="error" data-testid="project-error">
          {formErr}
        </p>
      )}
      {formOk && <p className="ok">{formOk}</p>}
    </section>
  );
}
