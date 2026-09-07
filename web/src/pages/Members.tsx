import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useList } from "@refinedev/core";
import { MemberList } from "./members/MemberList";

type Project = { id: string; name: string; slug: string };

/**
 * 成员与邀请（U3）。
 * 入口：`/members?project_id=` 或 `/projects/:id/members`
 */
export function MembersPage() {
  const { id: routeProjectId } = useParams<{ id?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryId = searchParams.get("project_id") ?? "";
  const initialId = routeProjectId || queryId;

  const { data, isLoading } = useList<Project>({ resource: "projects" });
  const projects = data?.data ?? [];
  const [projectId, setProjectId] = useState(initialId);

  useEffect(() => {
    setProjectId(initialId);
  }, [initialId]);

  const selected = useMemo(
    () => projects.find((p) => p.id === projectId),
    [projects, projectId],
  );

  function onSelectProject(id: string) {
    setProjectId(id);
    if (routeProjectId !== undefined) {
      if (id) navigate(`/projects/${id}/members`, { replace: true });
      else navigate("/members", { replace: true });
      return;
    }
    if (id) setSearchParams({ project_id: id }, { replace: true });
    else setSearchParams({}, { replace: true });
  }

  return (
    <section>
      <h2>成员 / 邀请</h2>
      <p className="muted">
        管理项目成员与邀请。已有 token？去 <Link to="/invitations/accept">接受邀请</Link>。
      </p>

      <div className="row wrap">
        <label>
          项目
          <select
            data-testid="member-project"
            value={projectId}
            onChange={(e) => onSelectProject(e.target.value)}
            disabled={isLoading}
          >
            <option value="">— 选择项目 —</option>
            {projectId && !projects.some((p) => p.id === projectId) && (
              <option value={projectId}>{projectId}（粘贴 / 路由）</option>
            )}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.slug ? ` (${p.slug})` : ""}
              </option>
            ))}
          </select>
        </label>
        {routeProjectId === undefined && (
          <label>
            或粘贴 project uuid
            <input
              className="mono"
              placeholder="uuid"
              value={projectId}
              onChange={(e) => onSelectProject(e.target.value.trim())}
              aria-label="project uuid"
            />
          </label>
        )}
      </div>

      {projectId ? (
        <MemberList projectId={projectId} projectName={selected?.name} />
      ) : (
        <p className="muted">从上方选择项目，或从项目详情带入 project_id。</p>
      )}
    </section>
  );
}
