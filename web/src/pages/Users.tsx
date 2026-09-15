import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useGetIdentity, useList } from "@refinedev/core";
import {
  Check,
  Clock,
  Copy,
  FolderKanban,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Shield,
  User,
  UserCog,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { friendlyError, type ApiError, type AuthUser } from "@/providers";
import { canManageUsers } from "@/lib/permissions";
import { roleChipLabel } from "@/pages/members/roles";
import { BatchCreateUsersDialog } from "@/pages/members/BatchCreateUsersDialog";
import { ASSIGNABLE_PLATFORM_ROLES, matchesUserFilters, matchesUserQuery, platformRoleLabel, USER_STATUS_FILTERS, userStatusLabel } from "@/pages/users/format";
import {
  type ActionKind,
  type PlatformUser,
  type Project,
  type UserProject,
  UserActionDialogs,
  UserRowActions,
} from "@/pages/users/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectBox } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Hint, Tooltip } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListCard, ListCardActions, ListCardHeader, ListCardMeta, ResponsiveList } from "@/components/ui/responsive-list";
import { PageFrame } from "@/components/ui/page-frame";
import { PageHeading } from "@/components/ui/page-heading";
import { Paginator } from "@/components/ui/pagination";
import { Elevated } from "@/lib/elevated";
import { Loading } from "@/ui";
import { copyText, fmtTime } from "@/ui/format";
import { useClientPager } from "@/lib/use-client-pager";
import { cn } from "@/lib/utils";

const PROJECTS_VISIBLE = 1;

function ProjectChip({ project }: { project: UserProject }) {
  return (
    <Hint label={`${roleChipLabel(project.role)} · ${project.slug || project.id}`}>
      <Link
        to={`/projects/${project.id}/members`}
        className="inline-flex max-w-[140px] items-center gap-1 whitespace-nowrap shrink-0 rounded-md border border-border/70 bg-surface-2/60 px-1.5 py-0.5 text-[11px] text-foreground hover:border-primary/40 hover:text-primary"
      >
        <FolderKanban className="size-3 shrink-0 opacity-70" />
        <span className="min-w-0 truncate">{project.name}</span>
      </Link>
    </Hint>
  );
}

function UserProjectsCell({ projects }: { projects: UserProject[] }) {
  if (projects.length === 0) {
    return <span className="text-xs text-muted-foreground">尚未加入项目</span>;
  }

  const visible = projects.slice(0, PROJECTS_VISIBLE);
  const overflow = projects.length - visible.length;

  return (
    <div className="inline-flex max-w-[220px] items-center gap-1 min-w-0">
      {visible.map((p) => (
        <ProjectChip key={p.id} project={p} />
      ))}
      {overflow > 0 ? (
        <Tooltip
          side="bottom"
          content={
            <div className="flex max-h-56 max-w-[260px] flex-col gap-1 overflow-y-auto py-0.5">
              {projects.map((p) => (
                <div key={p.id} className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap">
                  <FolderKanban className="size-3 shrink-0 opacity-70" />
                  <span className="min-w-0 truncate">{p.name}</span>
                  <span className="shrink-0 opacity-70">· {roleChipLabel(p.role)}</span>
                </div>
              ))}
            </div>
          }
        >
          <span
            className="inline-flex items-center whitespace-nowrap shrink-0 rounded-md border border-border/70 bg-surface-2/60 px-1.5 py-0.5 text-[11px] text-muted-foreground cursor-default"
            aria-label={`还有 ${overflow} 个项目`}
          >
            +{overflow}…
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}

function Forbidden() {
  return (
    <PageFrame
      header={
        <div className="flex items-center gap-3">
          <span className="size-9 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center shrink-0 border border-destructive/20 shadow-xs">
            <Shield className="size-4.5" />
          </span>
          <div>
            <h2 className="m-0 text-xl font-bold tracking-tight text-foreground">用户与团队</h2>
            <p className="mt-1 mb-0 text-sm text-muted-foreground">访问受限</p>
          </div>
        </div>
      }
    >
      <div className="py-8 flex justify-center">
        <Elevated
          offset={1}
          shadowLevel={2}
          className="rounded-2xl border border-destructive/30 bg-destructive/5 p-8 max-w-md w-full text-center flex flex-col items-center gap-3"
          data-testid="users-forbidden"
        >
          <Shield className="size-10 text-destructive" />
          <h3 className="m-0 text-base font-semibold text-foreground">无权查看用户列表</h3>
          <p className="m-0 text-xs text-muted-foreground leading-relaxed">
            仅平台管理员可以查看全部账号、批量创建用户，以及重置密码、禁用或删除账号。
          </p>
        </Elevated>
      </div>
    </PageFrame>
  );
}

function statusDotClass(status?: string) {
  if (status === "suspended" || status === "deleted") {
    return "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.45)]";
  }
  if (status && status !== "active") {
    return "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.45)]";
  }
  return "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.45)]";
}

function platformRoleBadge(role?: string) {
  if (role === "platform_admin") {
    return (
      <Badge variant="outline" className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 border-blue-500/35 bg-blue-500/10 text-blue-600 dark:text-blue-400">
        <Shield className="size-3 shrink-0" />
        {platformRoleLabel(role)}
      </Badge>
    );
  }
  if (role === "platform_ops") {
    return (
      <Badge variant="outline" className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-400">
        <UserCog className="size-3 shrink-0" />
        {platformRoleLabel(role)}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="inline-flex items-center gap-1 whitespace-nowrap shrink-0">
      <User className="size-3 shrink-0 opacity-70" />
      {platformRoleLabel(role)}
    </Badge>
  );
}

export function UsersPage() {
  const { data: me } = useGetIdentity<AuthUser>();
  const [searchParams] = useSearchParams();
  const allowed = canManageUsers(me?.platform_role);
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");

  useEffect(() => {
    setQuery(searchParams.get("q") ?? "");
  }, [searchParams]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [actionUser, setActionUser] = useState<PlatformUser | null>(null);
  const [action, setAction] = useState<ActionKind | null>(null);
  const [copiedId, setCopiedId] = useState("");

  const { data, isLoading, error, refetch } = useList<PlatformUser>({
    resource: "users",
    pagination: { mode: "off" },
    errorNotification: false,
    queryOptions: { retry: false, enabled: allowed },
  });
  const { data: projectData } = useList<Project>({
    resource: "projects",
    pagination: { mode: "off" },
    queryOptions: { enabled: allowed },
  });

  const users = data?.data ?? [];
  const projects = projectData?.data ?? [];
  const filtered = useMemo(
    () =>
      users.filter(
        (u) =>
          matchesUserQuery(u, query) &&
          matchesUserFilters(u, { role: roleFilter, status: statusFilter, projectId: projectFilter }),
      ),
    [users, query, roleFilter, statusFilter, projectFilter],
  );
  const pager = useClientPager(filtered, `platform-users:${query}:${roleFilter}:${statusFilter}:${projectFilter}`);
  const hasListFilter =
    query.trim() !== "" || roleFilter !== "all" || statusFilter !== "all" || projectFilter !== "all";

  const forbidden = (error as ApiError | undefined)?.status === 403 || (me !== undefined && !allowed);
  if (me === undefined) {
    return (
      <PageFrame
        header={
          <div className="flex items-center gap-3">
            <span className="size-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 border border-primary/20 shadow-xs">
              <Users className="size-4.5" />
            </span>
            <h2 className="m-0 text-xl font-bold tracking-tight text-foreground">用户与团队</h2>
          </div>
        }
      >
        <div className="py-12 text-center">
          <Loading label="校验权限…" />
        </div>
      </PageFrame>
    );
  }
  if (forbidden) return <Forbidden />;

  async function copyId(id: string) {
    const ok = await copyText(id);
    if (!ok) {
      toast.error("复制失败，请手动选中");
      return;
    }
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(""), 1600);
  }

  return (
    <>
      <PageFrame
        header={
          <PageHeading
            icon={Users}
            title="用户与团队"
            badges={
              <Badge variant="outline" className="inline-flex items-center whitespace-nowrap shrink-0 px-2 py-0.5 text-xs font-mono font-normal">
                {users.length} 人
              </Badge>
            }
            description="平台账号名册。可批量开号、重置密码、调整角色或禁用、删除账号。"
            actions={
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="compact"
                  onClick={() => void refetch()}
                  data-testid="users-refresh"
                  className="h-8 px-3 text-xs gap-1.5 shrink-0"
                >
                  <RefreshCw className="size-3.5 opacity-70 shrink-0" />
                  刷新
                </Button>
                <Button
                  type="button"
                  size="compact"
                  data-testid="users-batch-create-open"
                  onClick={() => setBatchOpen(true)}
                  className="h-8 px-3 text-xs gap-1.5 shrink-0"
                >
                  <Plus className="size-3.5 shrink-0" />
                  批量创建用户
                </Button>
              </>
            }
          >
            <div className="flex flex-col gap-2 min-w-0">
              <div className="relative w-full sm:max-w-sm">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  size="compact"
                  data-testid="users-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索姓名、用户名、邮箱或 ID"
                  className="pl-8"
                />
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <SelectBox
                  testId="users-filter-role"
                  size="compact"
                  aria-label="平台角色"
                  className="w-full min-w-0 sm:w-[160px]"
                  value={roleFilter}
                  onValueChange={setRoleFilter}
                  options={[
                    { value: "all", label: "全部角色" },
                    ...ASSIGNABLE_PLATFORM_ROLES.map((r) => ({ value: r, label: platformRoleLabel(r) })),
                  ]}
                />
                <SelectBox
                  testId="users-filter-status"
                  size="compact"
                  aria-label="账号状态"
                  className="w-full min-w-0 sm:w-[140px]"
                  value={statusFilter}
                  onValueChange={setStatusFilter}
                  options={[
                    { value: "all", label: "全部状态" },
                    ...USER_STATUS_FILTERS.map((s) => ({ value: s, label: userStatusLabel(s) })),
                  ]}
                />
                <SelectBox
                  testId="users-filter-project"
                  size="compact"
                  aria-label="所属项目"
                  className="w-full min-w-0 sm:w-[180px]"
                  value={projectFilter}
                  onValueChange={setProjectFilter}
                  options={[
                    { value: "all", label: "全部项目" },
                    { value: "none", label: "尚未加入项目" },
                    ...projects.map((p) => ({ value: p.id, label: p.name })),
                  ]}
                />
              </div>
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{friendlyError(error)}</AlertDescription>
              </Alert>
            )}
          </PageHeading>
        }
        footer={
          <Paginator
            page={pager.page}
            pageCount={pager.pageCount}
            pageSize={pager.pageSize}
            total={pager.total}
            onPageChange={pager.setPage}
            onPageSizeChange={pager.setPageSize}
          />
        }
      >
        {isLoading ? (
          <div className="py-12 text-center">
            <Loading label="加载用户列表…" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-8 flex flex-col items-center justify-center">
            <Elevated
              offset={1}
              shadowLevel={2}
              className="rounded-2xl border border-border/80 bg-surface-1 p-8 shadow-surface-2 text-center max-w-md w-full flex flex-col items-center gap-3"
            >
              <div className="size-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20 shadow-xs">
                <Users className="size-6" />
              </div>
              <div>
                <h3 className="m-0 text-base font-semibold text-foreground">
                  {hasListFilter ? "没有匹配的用户" : "还没有平台用户"}
                </h3>
                <p className="m-0 mt-1.5 text-xs text-muted-foreground leading-relaxed">
                  {hasListFilter
                    ? "换一个关键词或筛选条件试试，或清空后查看全部账号。"
                    : "点击右上角「批量创建用户」开一批测试账号，再按需配置角色或加入项目。"}
                </p>
              </div>
            </Elevated>
          </div>
        ) : (
          <ResponsiveList
            table={
              <div className="w-full overflow-x-auto rounded-xl border border-border/80 bg-surface-1 shadow-surface-1">
            <Table data-testid="users-table" stackOnMobile={false} className="min-w-[1080px]">
              <TableHeader className="sticky top-0 z-20 bg-surface-2/80 backdrop-blur-xs border-b border-border/70 select-none">
                <TableRow className="border-b border-border/60 hover:bg-transparent">
                  <TableHead className="py-2.5">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <User className="size-3.5 opacity-60 shrink-0" />
                      账号
                    </span>
                  </TableHead>
                  <TableHead className="w-[120px] py-2.5">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">姓名</span>
                  </TableHead>
                  <TableHead className="w-[220px] py-2.5">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <Mail className="size-3.5 opacity-60 shrink-0" />
                      邮箱
                    </span>
                  </TableHead>
                  <TableHead className="w-[150px] py-2.5">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <Shield className="size-3.5 opacity-60 shrink-0" />
                      平台角色
                    </span>
                  </TableHead>
                  <TableHead className="w-[110px] py-2.5">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">状态</span>
                  </TableHead>
                  <TableHead className="py-2.5">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <FolderKanban className="size-3.5 opacity-60 shrink-0" />
                      所属项目
                    </span>
                  </TableHead>
                  <TableHead className="w-[160px] py-2.5">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <Clock className="size-3.5 opacity-60 shrink-0" />
                      创建时间
                    </span>
                  </TableHead>
                  <TableHead stickyEnd className="w-[176px] py-2.5 pr-4 text-right">
                    <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap w-full">操作</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pager.slice.map((u) => (
                  <TableRow key={u.id} data-testid="users-row">
                    <TableCell className="py-2.5 whitespace-nowrap">
                      <div className="inline-flex items-center gap-2 min-w-0">
                        <span className={cn("size-2 rounded-full shrink-0", statusDotClass(u.status))} />
                        <span className="size-6 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-[11px] shrink-0 border border-primary/20">
                          {(u.display_name || u.username).slice(0, 1).toUpperCase()}
                        </span>
                        <span className="font-medium text-foreground">{u.username}</span>
                        <Hint label="复制 ID">
                          <Button
                            type="button"
                            variant="ghost"
                            size="compact"
                            className="size-6 p-0 shrink-0"
                            data-testid="users-copy-id"
                            onClick={() => void copyId(u.id)}
                          >
                            {copiedId === u.id ? (
                              <Check className="size-3 text-emerald-500 shrink-0" />
                            ) : (
                              <Copy className="size-3 opacity-60 shrink-0" />
                            )}
                          </Button>
                        </Hint>
                      </div>
                    </TableCell>
                    <TableCell className="py-2.5 whitespace-nowrap text-sm text-foreground">
                      {u.display_name?.trim() ? u.display_name : "—"}
                    </TableCell>
                    <TableCell className="py-2.5 whitespace-nowrap text-sm text-foreground">
                      {u.email || "—"}
                    </TableCell>
                    <TableCell className="py-2.5 whitespace-nowrap">
                      <Hint label={u.platform_role || "—"} className="font-mono">
                        {platformRoleBadge(u.platform_role)}
                      </Hint>
                    </TableCell>
                    <TableCell className="py-2.5 whitespace-nowrap">
                      <Hint label={u.status || "—"} className="font-mono">
                        {u.status === "suspended" || u.status === "deleted" ? (
                          <Badge variant="danger" className="inline-flex items-center whitespace-nowrap shrink-0">
                            {userStatusLabel(u.status)}
                          </Badge>
                        ) : (
                          <Badge variant="ok" className="inline-flex items-center whitespace-nowrap shrink-0">
                            {userStatusLabel(u.status)}
                          </Badge>
                        )}
                      </Hint>
                    </TableCell>
                    <TableCell className="py-2.5 whitespace-nowrap">
                      <UserProjectsCell projects={u.projects ?? []} />
                    </TableCell>
                    <TableCell className="py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                      {fmtTime(u.created_at)}
                    </TableCell>
                    <TableCell stickyEnd className="py-2.5 pr-4 text-right w-[176px]">
                      <UserRowActions
                        user={u}
                        isSelf={me?.id === u.id}
                        onAction={(kind, target) => {
                          setActionUser(target);
                          setAction(kind);
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
              </div>
            }
            cards={pager.slice.map((u) => (
              <ListCard key={u.id} data-testid="users-row">
                <ListCardHeader
                  leading={
                    <span className="inline-flex items-center gap-2 shrink-0">
                      <span className={cn("size-2 rounded-full shrink-0", statusDotClass(u.status))} />
                      <span className="size-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-[11px] shrink-0 border border-primary/20">
                        {(u.display_name || u.username).slice(0, 1).toUpperCase()}
                      </span>
                    </span>
                  }
                  title={u.username}
                  trailing={
                    <Hint label={u.status || "—"} className="font-mono">
                      {u.status === "suspended" || u.status === "deleted" ? (
                        <Badge variant="danger" className="inline-flex items-center whitespace-nowrap shrink-0">
                          {userStatusLabel(u.status)}
                        </Badge>
                      ) : (
                        <Badge variant="ok" className="inline-flex items-center whitespace-nowrap shrink-0">
                          {userStatusLabel(u.status)}
                        </Badge>
                      )}
                    </Hint>
                  }
                />
                <ListCardMeta className="text-foreground">
                  {u.display_name?.trim() ? (
                    <span className="inline-flex items-center gap-1 shrink-0">
                      <UserCog className="size-3 opacity-60 shrink-0" />
                      {u.display_name}
                    </span>
                  ) : null}
                  {u.email ? (
                    <span className="inline-flex min-w-0 items-center gap-1">
                      <Mail className="size-3 opacity-60 shrink-0" />
                      <span className="truncate">{u.email}</span>
                    </span>
                  ) : null}
                  <Hint label={u.platform_role || "—"} className="font-mono">
                    {platformRoleBadge(u.platform_role)}
                  </Hint>
                  <span className="inline-flex items-center gap-1 shrink-0">
                    <Clock className="size-3 opacity-60 shrink-0" />
                    {fmtTime(u.created_at)}
                  </span>
                </ListCardMeta>
                <div className="mt-2">
                  <UserProjectsCell projects={u.projects ?? []} />
                </div>
                <ListCardActions>
                  <Hint label="复制 ID">
                    <Button
                      type="button"
                      variant="ghost"
                      size="compact"
                      className="size-7 p-0 shrink-0"
                      data-testid="users-copy-id"
                      onClick={() => void copyId(u.id)}
                    >
                      {copiedId === u.id ? (
                        <Check className="size-3.5 text-emerald-500 shrink-0" />
                      ) : (
                        <Copy className="size-3.5 opacity-60 shrink-0" />
                      )}
                    </Button>
                  </Hint>
                  <UserRowActions
                    user={u}
                    isSelf={me?.id === u.id}
                    onAction={(kind, target) => {
                      setActionUser(target);
                      setAction(kind);
                    }}
                  />
                </ListCardActions>
              </ListCard>
            ))}
          />
        )}
      </PageFrame>

      <BatchCreateUsersDialog
        open={batchOpen}
        onOpenChange={setBatchOpen}
        projects={projects}
        onSuccess={() => void refetch()}
      />
      <UserActionDialogs
        user={actionUser ? users.find((u) => u.id === actionUser.id) ?? actionUser : null}
        action={action}
        projects={projects}
        onActionChange={(next, nextUser) => {
          setAction(next);
          if (nextUser !== undefined) setActionUser(nextUser);
          if (!next) setActionUser(null);
        }}
        onChanged={() => void refetch()}
      />
    </>
  );
}
