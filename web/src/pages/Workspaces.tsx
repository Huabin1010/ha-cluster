import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, friendlyError, isInsufficientCapacity } from "../providers";
import { Banner, Empty, Loading, useToast } from "../ui";
import { CreateForm } from "./workspaces/CreateForm";
import { WorkspaceRow } from "./workspaces/WorkspaceRow";
import { ProjectOption, Workspace } from "./workspaces/types";

export function WorkspacesPage() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectFilter = searchParams.get("project_id") || "";

  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [rows, setRows] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [insufficient, setInsufficient] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [usageTick, setUsageTick] = useState(0);

  const showError = useCallback((msg: string, isInsufficient = false) => {
    setErr(msg);
    setInsufficient(!!msg && (isInsufficient || isInsufficientCapacity(msg)));
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const json = await api<{ data: ProjectOption[]; total: number }>("/projects");
      setProjects(json.data ?? []);
    } catch (e) {
      showError(friendlyError(e));
    }
  }, [showError]);

  const loadWorkspaces = useCallback(async () => {
    setLoading(true);
    try {
      const q = projectFilter ? `?project_id=${encodeURIComponent(projectFilter)}` : "";
      const json = await api<{ data: Workspace[]; total: number }>(`/workspaces${q}`);
      const list = json.data ?? [];
      setRows(list.filter((w) => w.status !== "destroyed"));
    } catch (e) {
      showError(friendlyError(e), isInsufficientCapacity(e));
    } finally {
      setLoading(false);
    }
  }, [projectFilter, showError]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);

  function setProjectFilter(id: string) {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("project_id", id);
    else next.delete("project_id");
    setSearchParams(next, { replace: true });
  }

  function afterMutation() {
    setUsageTick((n) => n + 1);
    loadWorkspaces();
  }

  return (
    <section className="ws-page">
      <h2>Workspace</h2>
      <p className="muted">
        创建时硬占用账本；停止后仍占配额，销毁才释放。超卖返回 409 INSUFFICIENT_CAPACITY。
      </p>

      {err && (
        <Banner
          kind="error"
          className={insufficient ? "ws-insufficient" : undefined}
          onClose={() => showError("")}
        >
          <span data-testid="ws-error">{err}</span>
        </Banner>
      )}

      <CreateForm
        projects={projects}
        initialProjectId={projectFilter}
        usageTick={usageTick}
        onCreated={() => {
          showError("");
          toast.show("创建成功", "success");
          afterMutation();
        }}
        onError={showError}
      />

      <div className="row wrap filter-bar">
        <label>
          按项目筛选
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
            <option value="">全部项目</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.slug})
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="ghost" onClick={() => loadWorkspaces()}>
          刷新
        </button>
      </div>

      {loading ? (
        <Loading label="加载 Workspace…" />
      ) : rows.length === 0 ? (
        <Empty
          title={projectFilter ? "该项目还没有 Workspace" : "还没有 Workspace"}
          description="选择项目与套餐后创建一个；停止不会释放配额。"
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>套餐</th>
                <th>arch</th>
                <th>状态</th>
                <th>可见性</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <WorkspaceRow
                  key={w.id}
                  ws={w}
                  busyId={busyId}
                  onBusy={setBusyId}
                  onRefresh={afterMutation}
                  onToast={(msg) => toast.show(msg, "info")}
                  onError={(msg) => showError(msg)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
