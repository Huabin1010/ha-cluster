import { FormEvent, useEffect, useState } from "react";
import { api, friendlyError, isInsufficientCapacity } from "../../providers";
import { formatUsageHint } from "./format";
import { ARCHES, PLANS, ProjectOption, ProjectUsage } from "./types";

type Props = {
  projects: ProjectOption[];
  initialProjectId: string;
  /** bump to force usage reload after create/destroy */
  usageTick?: number;
  onCreated: () => void;
  onError: (msg: string, insufficient?: boolean) => void;
};

export function CreateForm({
  projects,
  initialProjectId,
  usageTick = 0,
  onCreated,
  onError,
}: Props) {
  const [projectId, setProjectId] = useState(initialProjectId);
  const [advancedId, setAdvancedId] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [plan, setPlan] = useState<string>("nano");
  const [arch, setArch] = useState<string>("amd64");
  const [visibility, setVisibility] = useState<"shared" | "private">("shared");
  const [name, setName] = useState("");
  const [usageHint, setUsageHint] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialProjectId) setProjectId(initialProjectId);
  }, [initialProjectId]);

  const effectiveProjectId = (showAdvanced && advancedId.trim() ? advancedId.trim() : projectId).trim();

  useEffect(() => {
    if (!effectiveProjectId) {
      setUsageHint("");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const u = await api<ProjectUsage>(`/projects/${effectiveProjectId}/usage`);
        if (!cancelled) setUsageHint(formatUsageHint(u));
      } catch {
        if (!cancelled) setUsageHint("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveProjectId, usageTick]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!effectiveProjectId) {
      onError("请选择项目");
      return;
    }
    setBusy(true);
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
      onCreated();
    } catch (err) {
      const insufficient = isInsufficientCapacity(err);
      onError(friendlyError(err), insufficient);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="ws-create" onSubmit={onSubmit} data-testid="ws-create">
      <div className="row wrap">
        <label>
          项目
          <select
            data-testid="ws-project-select"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={showAdvanced}
            required={!showAdvanced}
          >
            <option value="">选择项目…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.slug})
              </option>
            ))}
          </select>
        </label>
        <label>
          名称
          <input
            data-testid="ws-name-input"
            placeholder="可选，默认 plan-arch"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          套餐
          <select
            data-testid="ws-plan-select"
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
          >
            {PLANS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label>
          架构
          <select
            data-testid="ws-arch-select"
            value={arch}
            onChange={(e) => setArch(e.target.value)}
          >
            {ARCHES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label>
          可见性
          <select
            data-testid="ws-visibility-select"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as "shared" | "private")}
          >
            <option value="shared">shared（项目成员可 SSH）</option>
            <option value="private">private（仅 owner）</option>
          </select>
        </label>
        <button data-testid="ws-submit" disabled={busy} type="submit">
          {busy ? "创建中…" : "创建 Workspace"}
        </button>
      </div>
      <div className="row wrap">
        <button type="button" className="ghost" onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? "收起高级" : "高级：粘贴 project uuid"}
        </button>
        {showAdvanced && (
          <input
            className="mono"
            style={{ minWidth: "280px" }}
            placeholder="project uuid"
            value={advancedId}
            onChange={(e) => setAdvancedId(e.target.value)}
            aria-label="project uuid"
          />
        )}
      </div>
      {usageHint && <p className="muted usage-hint">{usageHint}</p>}
    </form>
  );
}
