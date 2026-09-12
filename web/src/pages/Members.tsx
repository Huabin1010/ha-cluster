import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useGetIdentity, useList } from "@refinedev/core";
import { Users, FolderKanban, ArrowRight, Plus, Mail } from "lucide-react";
import { MemberList } from "@/pages/members/MemberList";
import { BatchCreateUsersDialog } from "@/pages/members/BatchCreateUsersDialog";
import { SelectBox } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageFrame } from "@/components/ui/page-frame";
import { PageHeading } from "@/components/ui/page-heading";
import { Elevated } from "@/lib/elevated";
import { type AuthUser } from "@/providers";
import { readCurrentProject, writeCurrentProject } from "@/lib/current-project";

type Project = { id: string; name: string; slug: string };

export function MembersPage() {
  const { id: routeProjectId } = useParams<{ id?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryId = searchParams.get("project_id") ?? "";

  const { data: me } = useGetIdentity<AuthUser>();
  const isPlatformAdmin = me?.platform_role === "platform_admin";
  const [globalBatchOpen, setGlobalBatchOpen] = useState(false);

  const { data, isLoading } = useList<Project>({ resource: "projects" });
  const projects = data?.data ?? [];

  const savedProjectId = readCurrentProject();
  const initialId = routeProjectId || queryId || savedProjectId;
  const [projectId, setProjectId] = useState(initialId);

  useEffect(() => {
    if (routeProjectId || queryId) {
      setProjectId(routeProjectId || queryId);
    } else if (!projectId && savedProjectId && projects.some((p) => p.id === savedProjectId)) {
      setProjectId(savedProjectId);
    }
  }, [routeProjectId, queryId, savedProjectId, projects, projectId]);

  const selected = useMemo(
    () => projects.find((p) => p.id === projectId),
    [projects, projectId],
  );

  function onSelectProject(id: string) {
    setProjectId(id);
    writeCurrentProject(id);
    if (routeProjectId !== undefined) {
      if (id) navigate(`/projects/${id}/members`, { replace: true });
      else navigate("/members", { replace: true });
      return;
    }
    if (id) setSearchParams({ project_id: id }, { replace: true });
    else setSearchParams({}, { replace: true });
  }

  const projectOptions = [
    { value: "__none__", label: "— 选择协作项目 —" },
    ...(!projectId || projects.some((p) => p.id === projectId)
      ? []
      : [{ value: projectId, label: `${projectId}（指定路由）` }]),
    ...projects.map((p) => ({
      value: p.id,
      label: `${p.name}${p.slug ? ` (${p.slug})` : ""}`,
    })),
  ];

  const headingBadges = (
    <>
      <Badge variant="outline" className="inline-flex items-center whitespace-nowrap shrink-0 px-2 py-0.5 text-xs font-mono font-normal">
        {projects.length} 个项目
      </Badge>
      {selected && (
        <Badge variant="default" className="inline-flex max-w-full items-center gap-1 whitespace-nowrap shrink-0 px-2 py-0.5 text-xs font-normal">
          <FolderKanban className="size-3 shrink-0" />
          <span className="truncate">当前: {selected.name}</span>
        </Badge>
      )}
    </>
  );

  const headingDescription = (
    <>
      基于项目边界的团队成员权限与 SSH 访问管理。已有邀请 Token？可直接前往{" "}
      <Link to="/invitations/accept" data-testid="invite-accept-page" className="text-primary hover:underline font-medium inline-flex items-center gap-0.5">
        <Mail className="size-3" />
        接受邀请
      </Link>
      {isPlatformAdmin ? (
        <>
          。平台账号名册见{" "}
          <Link to="/users" data-testid="users-page-link" className="text-primary hover:underline font-medium inline-flex items-center gap-0.5">
            <Users className="size-3" />
            用户列表
          </Link>
          。
        </>
      ) : (
        "。"
      )}
    </>
  );

  const projectSelector = (
    <Elevated
      offset={1}
      shadowLevel={1}
      className="rounded-xl border border-border/80 bg-surface-1 p-3 shadow-surface-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <span className="text-xs font-medium text-muted-foreground shrink-0 inline-flex items-center gap-1.5">
          <FolderKanban className="size-3.5 text-primary shrink-0" />
          目标项目
        </span>
        <div className="w-full min-w-0 sm:max-w-sm">
          <SelectBox
            testId="member-project"
            value={projectId || "__none__"}
            onValueChange={(v) => onSelectProject(v === "__none__" ? "" : v)}
            disabled={isLoading}
            placeholder="— 选择项目 —"
            options={projectOptions}
          />
        </div>
      </div>

      {selected && (
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {selected.slug ? (
            <span className="font-mono bg-muted/40 px-2 py-0.5 rounded border border-border/60 text-foreground truncate max-w-[10rem]">
              {selected.slug}
            </span>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="compact"
            onClick={() => navigate(`/projects/${selected.id}`)}
            className="h-7 text-xs text-muted-foreground hover:text-foreground px-2 gap-1 inline-flex items-center whitespace-nowrap shrink-0"
          >
            <span>查看项目详情</span>
            <ArrowRight className="size-3 shrink-0" />
          </Button>
        </div>
      )}
    </Elevated>
  );

  if (!projectId) {
    return (
      <>
        <PageFrame
          header={
            <PageHeading
              icon={Users}
              title="成员与权限"
              badges={headingBadges}
              description={headingDescription}
              actions={
                isPlatformAdmin ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="compact"
                    data-testid="global-batch-create-open"
                    onClick={() => setGlobalBatchOpen(true)}
                    className="h-8 px-3 text-xs gap-1.5 shrink-0"
                  >
                    <Users className="size-3.5 shrink-0" />
                    批量创建用户
                  </Button>
                ) : undefined
              }
            >
              {projectSelector}
            </PageHeading>
          }
        >
          <div className="py-6 flex flex-col items-center justify-center">
            <Elevated
              offset={1}
              shadowLevel={2}
              className="rounded-2xl border border-border/80 bg-surface-1 p-6 sm:p-8 shadow-surface-2 text-center max-w-xl w-full flex flex-col items-center gap-4"
            >
              <div className="size-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20 shadow-xs">
                <Users className="size-6" />
              </div>
              <div className="min-w-0">
                <h3 className="m-0 text-base font-semibold text-foreground">请选择要管理成员的项目</h3>
                <p className="m-0 mt-1.5 text-xs text-muted-foreground leading-relaxed break-words">
                  ha-cluster 的成员与 SSH 授权基于项目边界进行隔离。
                  请在上方下拉菜单选择项目，或从下方快速点选已有项目进入管理。
                </p>
              </div>

              {projects.length > 0 ? (
                <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 text-left">
                  {projects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onSelectProject(p.id)}
                      className="p-3 rounded-xl border border-border/70 bg-surface-2/40 hover:bg-hover hover:border-primary/40 transition-all flex flex-col gap-1 text-left group cursor-pointer min-w-0"
                    >
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                          {p.name}
                        </span>
                        <ArrowRight className="size-3 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                      </div>
                      <span className="text-[11px] font-mono text-muted-foreground truncate">
                        {p.slug || p.id.slice(0, 8)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="pt-2">
                  <Button
                    type="button"
                    size="compact"
                    onClick={() => navigate("/projects")}
                    className="h-8 px-4 text-xs gap-1.5 font-medium"
                  >
                    <Plus className="size-3.5" />
                    前往创建第一个项目
                  </Button>
                </div>
              )}
            </Elevated>
          </div>
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
    <MemberList
      projectId={projectId}
      projectName={selected?.name}
      headingTitle="成员与权限"
      headingBadges={headingBadges}
      headingDescription={headingDescription}
      extraHeader={projectSelector}
    />
  );
}
