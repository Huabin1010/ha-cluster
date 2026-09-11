import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useGetIdentity, useList } from "@refinedev/core";
import { Users, FolderKanban, ArrowRight, Plus, Mail, Shield } from "lucide-react";
import { MemberList } from "@/pages/members/MemberList";
import { BatchCreateUsersDialog } from "@/pages/members/BatchCreateUsersDialog";
import { SelectBox } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageFrame } from "@/components/ui/page-frame";
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

  // 优先级：路由参数 > URL Query > 全局当前项目缓存
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

  const headerContent = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="size-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 border border-primary/20 shadow-xs">
            <Users className="size-4.5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="m-0 text-xl font-bold tracking-tight text-foreground">成员与权限</h2>
              <Badge variant="outline" className="px-2 py-0.5 text-xs font-mono font-normal">
                {projects.length} 个项目
              </Badge>
              {selected && (
                <Badge variant="default" className="px-2 py-0.5 text-xs font-normal inline-flex items-center gap-1">
                  <FolderKanban className="size-3" />
                  当前: {selected.name}
                </Badge>
              )}
            </div>
            <p className="mt-1 mb-0 text-sm text-muted-foreground">
              基于项目边界的团队成员权限与 SSH 访问管理。已有邀请 Token？可直接前往{" "}
              <Link to="/invitations/accept" className="text-primary hover:underline font-medium inline-flex items-center gap-0.5">
                <Mail className="size-3" />
                接受邀请
              </Link>
              。
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isPlatformAdmin && (
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
          )}
        </div>
      </div>

      {/* 快捷项目切换栏 */}
      <Elevated
        offset={1}
        shadowLevel={1}
        className="rounded-xl border border-border/80 bg-surface-1 p-3 shadow-surface-1 flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="text-xs font-medium text-muted-foreground shrink-0 flex items-center gap-1.5">
            <FolderKanban className="size-3.5 text-primary" />
            目标项目:
          </span>
          <div className="w-full max-w-xs sm:max-w-sm">
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
          <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
            <span className="font-mono bg-muted/40 px-2 py-0.5 rounded border border-border/60 text-foreground">
              {selected.slug}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="compact"
              onClick={() => navigate(`/projects/${selected.id}`)}
              className="h-7 text-xs text-muted-foreground hover:text-foreground px-2 gap-1"
            >
              <span>查看项目详情</span>
              <ArrowRight className="size-3" />
            </Button>
          </div>
        )}
      </Elevated>
    </div>
  );

  if (!projectId) {
    return (
      <>
        <PageFrame header={headerContent}>
          <div className="py-6 flex flex-col items-center justify-center">
            <Elevated
              offset={1}
              shadowLevel={2}
              className="rounded-2xl border border-border/80 bg-surface-1 p-8 shadow-surface-2 text-center max-w-xl w-full flex flex-col items-center gap-4"
            >
              <div className="size-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20 shadow-xs">
                <Users className="size-6" />
              </div>
              <div>
                <h3 className="m-0 text-base font-semibold text-foreground">请选择要管理成员的项目</h3>
                <p className="m-0 mt-1.5 text-xs text-muted-foreground leading-relaxed">
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
                      className="p-3 rounded-xl border border-border/70 bg-surface-2/40 hover:bg-hover hover:border-primary/40 transition-all flex flex-col gap-1 text-left group cursor-pointer"
                    >
                      <div className="flex items-center justify-between">
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
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="shrink-0">{headerContent}</div>
      <div className="min-h-0 flex-1">
        <MemberList projectId={projectId} projectName={selected?.name} />
      </div>
      <BatchCreateUsersDialog
        open={globalBatchOpen}
        onOpenChange={setGlobalBatchOpen}
        projects={projects}
      />
    </div>
  );
}
