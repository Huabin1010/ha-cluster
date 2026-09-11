import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
import { matchesUserQuery, platformRoleLabel, userStatusLabel } from "@/pages/users/format";
import { type ActionKind, type PlatformUser, type Project, UserActionDialogs, UserRowActions } from "@/pages/users/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Hint } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageFrame } from "@/components/ui/page-frame";
import { PageHeading } from "@/components/ui/page-heading";
import { Paginator } from "@/components/ui/pagination";
import { Elevated } from "@/lib/elevated";
import { Loading } from "@/ui";
import { copyText, fmtTime } from "@/ui/format";
import { useClientPager } from "@/lib/use-client-pager";
import { cn } from "@/lib/utils";

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
            仅平台管理员可以查看全部账号、批量创建用户，以及重置密码、停用或删除账号。
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
  const allowed = canManageUsers(me?.platform_role);
  const [query, setQuery] = useState("");
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
    () => users.filter((u) => matchesUserQuery(u, query)),
    [users, query],
  );
  const pager = useClientPager(filtered, `platform-users:${query}`);

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
            description="平台账号名册。可批量开号、重置密码、调整角色或停用、删除账号。"
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
            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                size="compact"
                data-testid="users-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索用户名、邮箱或 ID"
                className="pl-8"
              />
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
                  {query.trim() ? "没有匹配的用户" : "还没有平台用户"}
                </h3>
                <p className="m-0 mt-1.5 text-xs text-muted-foreground leading-relaxed">
                  {query.trim()
                    ? "换一个关键词试试，或清空搜索查看全部账号。"
                    : "点击右上角「批量创建用户」开一批测试账号，再按需配置角色或加入项目。"}
                </p>
              </div>
            </Elevated>
          </div>
        ) : (
          <div className="w-full overflow-x-auto rounded-xl border border-border/80 bg-surface-1 shadow-surface-1">
            <Table data-testid="users-table" className="min-w-[960px]">
              <TableHeader className="sticky top-0 z-20 bg-surface-2/80 backdrop-blur-xs border-b border-border/70 select-none">
                <TableRow className="border-b border-border/60 hover:bg-transparent">
                  <TableHead className="py-2.5">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <User className="size-3.5 opacity-60 shrink-0" />
                      账号
                    </span>
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
                  <TableHead stickyEnd className="w-[148px] py-2.5 pr-4 text-right">
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
                          {u.username.slice(0, 1).toUpperCase()}
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
                    <TableCell className="py-2.5">
                      {u.projects && u.projects.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1">
                          {u.projects.map((p) => (
                            <Hint key={p.id} label={`${roleChipLabel(p.role)} · ${p.slug || p.id}`}>
                              <Link
                                to={`/projects/${p.id}/members`}
                                className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 rounded-md border border-border/70 bg-surface-2/60 px-1.5 py-0.5 text-[11px] text-foreground hover:border-primary/40 hover:text-primary"
                              >
                                <FolderKanban className="size-3 shrink-0 opacity-70" />
                                {p.name}
                              </Link>
                            </Hint>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">尚未加入项目</span>
                      )}
                    </TableCell>
                    <TableCell className="py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                      {fmtTime(u.created_at)}
                    </TableCell>
                    <TableCell stickyEnd className="py-2.5 pr-4 text-right w-[148px]">
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
