import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useGetIdentity, useList } from "@refinedev/core";
import { Users } from "lucide-react";
import { MemberList } from "./members/MemberList";
import { BatchCreateUsersDialog } from "./members/BatchCreateUsersDialog";
import { PageHeader } from "../ui";
import { SelectBox } from "../components/ui/select";
import { Input } from "../components/ui/input";
import { Field } from "../components/ui/field";
import { Button } from "../components/ui/button";
import { PageFrame } from "../components/ui/page-frame";
import { type AuthUser } from "../providers";

type Project = { id: string; name: string; slug: string };

export function MembersPage() {
  const { id: routeProjectId } = useParams<{ id?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryId = searchParams.get("project_id") ?? "";
  const initialId = routeProjectId || queryId;

  const { data: me } = useGetIdentity<AuthUser>();
  const isPlatformAdmin = me?.platform_role === "platform_admin";
  const [globalBatchOpen, setGlobalBatchOpen] = useState(false);

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

  const filters = (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="项目" className="min-w-52">
        <SelectBox
          testId="member-project"
          value={projectId || "__none__"}
          onValueChange={(v) => onSelectProject(v === "__none__" ? "" : v)}
          disabled={isLoading}
          placeholder="— 选择项目 —"
          options={[
            { value: "__none__", label: "— 选择项目 —" },
            ...(!projectId || projects.some((p) => p.id === projectId)
              ? []
              : [{ value: projectId, label: `${projectId}（粘贴 / 路由）` }]),
            ...projects.map((p) => ({
              value: p.id,
              label: `${p.name}${p.slug ? ` (${p.slug})` : ""}`,
            })),
          ]}
        />
      </Field>
      {routeProjectId === undefined && (
        <Field label="或粘贴 project uuid" className="min-w-64">
          <Input
            className="mono font-mono"
            placeholder="uuid"
            value={projectId}
            onChange={(e) => onSelectProject(e.target.value.trim())}
            aria-label="project uuid"
          />
        </Field>
      )}
    </div>
  );

  if (!projectId) {
    return (
      <>
        <PageFrame
          header={
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <PageHeader title="成员 / 邀请" />
                {isPlatformAdmin && (
                  <Button
                    type="button"
                    variant="outline"
                    data-testid="global-batch-create-open"
                    onClick={() => setGlobalBatchOpen(true)}
                  >
                    <Users className="h-4 w-4" />
                    批量创建用户
                  </Button>
                )}
              </div>
              <p className="m-0 text-sm text-muted-foreground">
                管理项目成员与邀请。已有 token？去{" "}
                <Button variant="link" className="h-auto p-0" asChild>
                  <Link to="/invitations/accept">接受邀请</Link>
                </Button>
                。
              </p>
              {filters}
            </div>
          }
        >
          <p className="text-sm text-muted-foreground">从上方选择项目，或从项目详情带入 project_id。</p>
        </PageFrame>
        <BatchCreateUsersDialog
          open={globalBatchOpen}
          onOpenChange={setGlobalBatchOpen}
          projects={projects}
        />
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="shrink-0 grid gap-3">
        <PageHeader title="成员 / 邀请" />
        <p className="m-0 text-sm text-muted-foreground">
          管理项目成员与邀请。已有 token？去{" "}
          <Button variant="link" className="h-auto p-0" asChild>
            <Link to="/invitations/accept">接受邀请</Link>
          </Button>
          。
        </p>
        {filters}
      </div>
      <MemberList projectId={projectId} projectName={selected?.name} />
    </div>
  );
}
