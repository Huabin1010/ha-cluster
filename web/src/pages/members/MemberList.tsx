import { FormEvent, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check, CircleHelp, Clock, Copy, ExternalLink, Eye, Hash, Mail, Plus, Shield, Terminal, Trash2, User, Users } from "lucide-react";
import { useGetIdentity } from "@refinedev/core";
import { api, friendlyError, type AuthUser } from "@/providers";
import {
  ASSIGNABLE_ROLES,
  MEMBER_ROLES,
  MEMBER_SSH_FILTERS,
  ROLE_HELP,
  SSH_HELP,
  matchesMemberFilters,
  memberSshFilterLabel,
  roleChipLabel,
  roleLabel,
} from "./roles";
import { canManageMembers, canSSH } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { SelectBox } from "@/components/ui/select";
import { memberCandidateLabel, type MemberCandidate } from "./directory";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Hint } from "@/components/ui/tooltip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PageFrame } from "@/components/ui/page-frame";
import { PageHeading } from "@/components/ui/page-heading";
import { Paginator } from "@/components/ui/pagination";
import { ListCard, ListCardActions, ListCardHeader, ListCardMeta, ResponsiveList, TableShell } from "@/components/ui/responsive-list";
import { Elevated } from "@/lib/elevated";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loading } from "@/ui";
import { copyText as writeClipboard } from "@/ui/format";
import { useClientPager } from "@/lib/use-client-pager";
import { BatchCreateUsersDialog } from "./BatchCreateUsersDialog";

export type Member = {
  project_id: string;
  user_id: string;
  role: string;
  username?: string;
  ssh_access?: string;
  ssh_mode?: string;
};

type UserItem = { id: string; username: string; email?: string };

const ROLE_SELECT_OPTIONS = [
  { value: "viewer", label: roleChipLabel("viewer"), icon: Eye },
  { value: "developer", label: roleChipLabel("developer"), icon: User },
  { value: "admin", label: roleChipLabel("admin"), icon: Shield },
] as const;

function roleSelectClass(role: string, fullWidth = false): string {
  const width = fullWidth ? "w-full min-w-0 max-w-none" : "min-w-[168px] max-w-[200px]";
  switch (role) {
    case "admin":
      return `${width} border-blue-500/35 bg-blue-500/10 text-blue-600 [&_svg]:text-blue-500`;
    case "developer":
      return `${width} border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 [&_svg]:text-emerald-500`;
    default:
      return `${width} border-border/80 bg-surface-2/50 text-foreground [&_svg]:text-muted-foreground`;
  }
}

type Props = {
  projectId: string;
  projectName?: string;
  headingTitle?: string;
  headingDescription?: ReactNode;
  headingBadges?: ReactNode;
  extraHeader?: ReactNode;
};

export function MemberList({
  projectId,
  projectName,
  headingTitle,
  headingDescription,
  headingBadges,
  extraHeader,
}: Props) {
  const [rows, setRows] = useState<Member[]>([]);
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [candidates, setCandidates] = useState<MemberCandidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [addRole, setAddRole] = useState<string>("developer");
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("developer");
  const [inviteToken, setInviteToken] = useState("");
  const [copied, setCopied] = useState<"token" | "link" | "">("");
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [roleFilter, setRoleFilter] = useState("all");
  const [sshFilter, setSshFilter] = useState("all");
  const [helpOpen, setHelpOpen] = useState(false);
  const filteredRows = useMemo(
    () => rows.filter((m) => matchesMemberFilters(m, { role: roleFilter, ssh: sshFilter })),
    [rows, roleFilter, sshFilter],
  );
  const pager = useClientPager(filteredRows, `${projectId}:${roleFilter}:${sshFilter}`);

  const { data: me } = useGetIdentity<AuthUser>();
  const myMember = rows.find((r) => r.user_id === me?.id);
  const myRole = myMember?.role;
  const mySshAccess = myMember?.ssh_access;
  const isPlatformAdmin = me?.platform_role === "platform_admin";
  const canManage = canManageMembers(myRole, me?.platform_role);
  const canBatchCreate = canManage;

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setErr("");
    try {
      const [json, usersRes] = await Promise.allSettled([
        api<{ data: Member[] }>(`/projects/${projectId}/members`),
        api<{ data: UserItem[] }>("/users"),
      ]);
      if (json.status === "fulfilled") {
        setRows(json.value.data ?? []);
      } else {
        throw json.reason;
      }
      if (usersRes.status === "fulfilled" && usersRes.value?.data) {
        const map: Record<string, string> = {};
        for (const u of usersRes.value.data) {
          map[u.id] = u.username;
        }
        setUserMap(map);
      }
    } catch (e) {
      setErr(friendlyError(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    setInviteToken("");
    setCopied("");
    setRoleFilter("all");
    setSshFilter("all");
  }, [load]);

  useEffect(() => {
    if (!addOpen || !projectId) return;
    setUsername("");
    let cancelled = false;
    setErr("");
    setCandidatesLoading(true);
    void api<{ data: MemberCandidate[] }>(`/projects/${projectId}/member-candidates`)
      .then((json) => {
        if (!cancelled) setCandidates(json.data ?? []);
      })
      .catch((e) => {
        if (!cancelled) {
          setCandidates([]);
          setErr(friendlyError(e));
        }
      })
      .finally(() => {
        if (!cancelled) setCandidatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [addOpen, projectId]);

  const candidateOptions = useMemo(() => {
    const memberIds = new Set(rows.map((r) => r.user_id));
    return candidates
      .filter((u) => !memberIds.has(u.id))
      .map((u) => ({ value: u.username, label: memberCandidateLabel(u) }));
  }, [candidates, rows]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await api(`/projects/${projectId}/members`, {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), role: addRole }),
      });
      setUsername("");
      setAddOpen(false);
      await load();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function patchMember(userId: string, body: Record<string, string>) {
    setErr("");
    setBusy(true);
    try {
      await api(`/projects/${projectId}/members/${userId}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      await load();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(m: Member, role: string) {
    if (role === m.role) return;
    const body: Record<string, string> = { role };
    if (role === "admin") body.ssh_access = "granted";
    await patchMember(m.user_id, body);
  }

  async function toggleSSH(m: Member) {
    const next = m.ssh_access === "granted" ? "revoked" : "granted";
    await patchMember(m.user_id, { ssh_access: next });
  }

  async function requestSSH() {
    setErr("");
    setBusy(true);
    try {
      await api(`/projects/${projectId}/ssh-access-request`, { method: "POST", body: "{}" });
      await load();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: string, role: string) {
    if (role === "owner") {
      setErr("不能移除 owner；请先转让所有权（本表单不支持）");
      return;
    }
    setRemoveId(userId);
  }

  async function confirmRemove() {
    if (!removeId) return;
    const userId = removeId;
    setRemoveId(null);
    setErr("");
    setBusy(true);
    try {
      await api(`/projects/${projectId}/members/${userId}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function invite(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setCopied("");
    setBusy(true);
    try {
      const inv = await api<{ token: string }>(`/projects/${projectId}/invitations`, {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), role: inviteRole }),
      });
      setInviteToken(inv.token);
      setEmail("");
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const acceptPath = inviteToken
    ? `/invitations/accept?token=${encodeURIComponent(inviteToken)}`
    : "/invitations/accept";

  async function copyInvite(kind: "token" | "link", value: string) {
    const ok = await writeClipboard(value);
    if (!ok) {
      setErr("复制失败，请手动选中文本");
      return;
    }
    setCopied(kind);
  }

  if (!projectId) {
    return <p className="text-sm text-muted-foreground">请选择一个项目</p>;
  }

  function renderRoleBadge(role: string) {
    if (role === "owner") {
      return (
        <Badge variant="outline" className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap border-amber-500/35 text-amber-700 bg-amber-500/10 dark:text-amber-400">
          <Shield className="size-3.5 text-amber-500 shrink-0" />
          所有者 (OWNER)
        </Badge>
      );
    }
    if (role === "admin") {
      return (
        <Badge variant="outline" className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap border-blue-500/35 text-blue-600 bg-blue-500/10 dark:text-blue-400">
          <Shield className="size-3.5 text-blue-500 shrink-0" />
          管理员 (ADMIN)
        </Badge>
      );
    }
    if (role === "developer") {
      return (
        <Badge variant="outline" className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap border-emerald-500/35 text-emerald-700 bg-emerald-500/10 dark:text-emerald-400">
          <User className="size-3.5 text-emerald-500 shrink-0" />
          开发者 (DEV)
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap border-border/80 text-foreground bg-surface-2/50">
        <Eye className="size-3.5 text-muted-foreground shrink-0" />
        观察者 (VIEWER)
      </Badge>
    );
  }

  function renderRoleControl(m: Member, fullWidth = false) {
    if (m.role === "owner" || !canManage) {
      return renderRoleBadge(m.role);
    }
    return (
      <SelectBox
        size="compact"
        testId="member-role-select"
        aria-label="项目角色"
        value={m.role}
        disabled={busy}
        className={roleSelectClass(m.role, fullWidth)}
        onValueChange={(role) => void changeRole(m, role)}
        options={ROLE_SELECT_OPTIONS.map((r) => ({
          value: r.value,
          label: r.label,
          icon: r.icon,
        }))}
      />
    );
  }

  function renderSshControl(m: Member) {
    if (canManage && m.role !== "owner" && m.role !== "admin") {
      return (
        <Hint label={m.ssh_access === "granted" ? "点击取消授权" : "点击授权"}>
          <button
            type="button"
            data-testid="member-ssh-toggle"
            disabled={busy}
            aria-label={m.ssh_access === "granted" ? "取消 SSH 授权" : "授予 SSH 授权"}
            onClick={() => void toggleSSH(m)}
            className="inline-flex cursor-pointer items-center rounded-md transition-opacity duration-80 hover:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)] disabled:opacity-50"
          >
            {renderSshBadge(m.ssh_access, m.ssh_mode)}
          </button>
        </Hint>
      );
    }
    return renderSshBadge(m.ssh_access, m.ssh_mode);
  }

  function renderSshBadge(access?: string, mode?: string) {
    if (access === "granted") {
      return (
        <Badge variant="ok" className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap">
          <Check className="size-3 text-emerald-500 shrink-0" />
          {mode === "read_only" ? "只读 (RO)" : "已授权 (RW)"}
        </Badge>
      );
    }
    if (access === "pending") {
      return (
        <Badge variant="warn" className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap">
          <Clock className="size-3 text-amber-500 shrink-0" />
          待审批
        </Badge>
      );
    }
    if (access === "revoked") {
      return (
        <Badge variant="danger" className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap">
          已撤销
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap text-muted-foreground opacity-60">
        未开通
      </Badge>
    );
  }

  const tokenBox = inviteToken ? (
    <Alert variant="info" data-testid="invite-token" className="mt-2">
      <AlertDescription className="grid gap-3">
        <p className="m-0 text-xs">把下面的 token 发给对方（或分享带 token 的链接）。对方登录后打开接受页即可加入。</p>
        <code className="mono invite-token-text block break-all rounded-md bg-background p-2 font-mono text-xs border border-border/70">{inviteToken}</code>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="compact"
            data-testid="invite-copy"
            className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 h-7 text-xs"
            onClick={() => void copyInvite("token", inviteToken)}
          >
            {copied === "token" ? <Check className="size-3 text-emerald-500 shrink-0" /> : <Copy className="size-3 opacity-70 shrink-0" />}
            {copied === "token" ? "已复制" : "复制 Token"}
          </Button>
          <Button variant="default" size="compact" asChild className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 h-7 text-xs">
            <Link to={acceptPath} data-testid="invite-accept-link">
              <ExternalLink className="size-3 shrink-0" />
              打开接受页
            </Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="compact"
            className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 h-7 text-xs"
            onClick={() => void copyInvite("link", `${window.location.origin}${acceptPath}`)}
          >
            {copied === "link" ? <Check className="size-3 text-emerald-500 shrink-0" /> : <Copy className="size-3 opacity-70 shrink-0" />}
            {copied === "link" ? "已复制链接" : "复制邀请链接"}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  ) : null;

  return (
    <>
      <PageFrame
        className="members-panel"
        header={
          <PageHeading
            icon={Users}
            title={headingTitle ?? (projectName ? `${projectName} · 项目成员` : "项目成员名单")}
            badges={headingBadges}
            description={
              headingDescription ?? (
                <>
                  <Hint label={projectId}>
                    <span className="font-mono cursor-help">项目 ID: {projectId.slice(0, 8)}…</span>
                  </Hint>
                  <span className="hidden sm:inline"> · 管理团队成员与 SSH 跳板机接入权限</span>
                </>
              )
            }
            actions={
              <>
                {myRole === "developer" && !canSSH(myRole, mySshAccess, me?.platform_role) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="compact"
                    data-testid="member-request-ssh"
                    disabled={busy || mySshAccess === "pending"}
                    className="h-8 px-3 text-xs gap-1.5 shrink-0"
                    onClick={() => void requestSSH()}
                  >
                    <Terminal className="size-3.5 shrink-0" />
                    {mySshAccess === "pending" ? "SSH 待审批" : "申请 SSH 权限"}
                  </Button>
                )}
                {canBatchCreate && (
                  <Button
                    type="button"
                    variant="outline"
                    size="compact"
                    data-testid="batch-create-open"
                    className="h-8 px-3 text-xs gap-1.5 shrink-0"
                    onClick={() => setBatchOpen(true)}
                  >
                    <Users className="size-3.5 shrink-0" />
                    批量创建用户
                  </Button>
                )}
                {canManage && (
                  <>
                <Dialog
                  open={addOpen}
                  onOpenChange={(open) => {
                    setAddOpen(open);
                    if (!open) setUsername("");
                  }}
                >
                  <DialogTrigger asChild>
                    <Button type="button" size="compact" data-testid="member-add-open" className="h-8 px-3 text-xs gap-1.5 shrink-0">
                      <Plus className="size-3.5 shrink-0" />
                      添加成员
                    </Button>
                  </DialogTrigger>
                  <DialogContent size="lg" className="sm:max-w-lg">
                    <DialogHeader>
                      <DialogTitle>添加成员</DialogTitle>
                      <DialogDescription className="break-words min-w-0">
                        搜索已有账号并选择角色加入当前项目。owner 不可通过此表单转让。
                      </DialogDescription>
                    </DialogHeader>
                    <form className="flex min-h-0 flex-1 flex-col" onSubmit={add} data-testid="member-add-form">
                      <DialogBody className="grid gap-4 overflow-x-hidden overflow-y-auto max-w-full">
                        <Field label="用户">
                          <Combobox
                            testId="member-username"
                            value={username}
                            onValueChange={setUsername}
                            options={candidateOptions}
                            placeholder={candidatesLoading ? "加载用户…" : "搜索并选择用户"}
                            searchPlaceholder="搜索用户名或显示名…"
                            emptyText={candidatesLoading ? "正在加载…" : "未找到可添加的用户"}
                            disabled={candidatesLoading}
                            aria-label="选择要添加的用户"
                            className="w-full"
                            contentClassName="max-w-none"
                          />
                          {!candidatesLoading && candidateOptions.length === 0 && (
                            <p className="text-xs text-muted-foreground break-words min-w-0">
                              没有可添加的账号。可先在用户列表创建，或使用「生成邀请」。
                            </p>
                          )}
                        </Field>
                        <Field label="项目角色">
                          <SelectBox
                            testId="member-role"
                            value={addRole}
                            onValueChange={setAddRole}
                            options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))}
                          />
                        </Field>
                      </DialogBody>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                          取消
                        </Button>
                        <Button data-testid="member-add" type="submit" disabled={busy || !username.trim()}>
                          添加成员
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>

                <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
                  <DialogTrigger asChild>
                    <Button type="button" variant="outline" size="compact" data-testid="invite-open" className="h-8 px-3 text-xs gap-1.5 shrink-0">
                      <Mail className="size-3.5 shrink-0" />
                      生成邀请
                    </Button>
                  </DialogTrigger>
                  <DialogContent size="lg" className="sm:max-w-lg">
                    <DialogHeader>
                      <DialogTitle>生成邀请链接</DialogTitle>
                      <DialogDescription>生成专用一次性邀请 Token，受邀成员登录后即可加入本项目。</DialogDescription>
                    </DialogHeader>
                    <form className="flex min-h-0 flex-1 flex-col" onSubmit={invite} data-testid="invite-form">
                      <DialogBody className="grid gap-4 overflow-x-hidden overflow-y-auto max-w-full">
                        <Field label="受邀人邮箱">
                          <Input
                            type="email"
                            data-testid="invite-email"
                            placeholder="colleague@example.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                          />
                        </Field>
                        <Field label="初始角色">
                          <SelectBox
                            testId="invite-role"
                            value={inviteRole}
                            onValueChange={setInviteRole}
                            options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))}
                          />
                        </Field>
                        {tokenBox}
                      </DialogBody>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
                          取消
                        </Button>
                        <Button type="submit" disabled={busy}>
                          生成邀请 Token
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
                  </>
                )}
              </>
            }
          >
            {extraHeader}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 shrink-0 text-xs font-medium text-muted-foreground">
                <Shield className="size-3.5 shrink-0 opacity-70" />
                项目角色
                <Hint label="项目角色与权限说明">
                  <Button
                    type="button"
                    variant="ghost"
                    size="compact"
                    data-testid="role-help"
                    aria-label="项目角色与权限说明"
                    className="size-6 p-0 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => setHelpOpen(true)}
                  >
                    <CircleHelp className="size-3.5 shrink-0" />
                  </Button>
                </Hint>
              </span>
              <SelectBox
                testId="member-filter-role"
                size="compact"
                aria-label="筛选项目角色"
                className="w-full min-w-0 sm:w-[180px]"
                value={roleFilter}
                onValueChange={setRoleFilter}
                options={[
                  { value: "all", label: "全部角色" },
                  ...MEMBER_ROLES.map((r) => ({ value: r, label: roleChipLabel(r) })),
                ]}
              />
              <SelectBox
                testId="member-filter-ssh"
                size="compact"
                aria-label="筛选 SSH 权限"
                className="w-full min-w-0 sm:w-[160px]"
                value={sshFilter}
                onValueChange={setSshFilter}
                options={[
                  { value: "all", label: "全部 SSH" },
                  ...MEMBER_SSH_FILTERS.map((s) => ({ value: s, label: memberSshFilterLabel(s) })),
                ]}
              />
            </div>
            {err && (
              <Alert variant="destructive" role="alert" data-testid="member-error">
                <AlertDescription>{err}</AlertDescription>
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
        <div className="grid gap-4">
          {loading ? (
            <div className="py-12 text-center">
              <Loading label="加载成员名单…" />
            </div>
          ) : rows.length === 0 ? (
            <Elevated
              offset={1}
              shadowLevel={1}
              className="rounded-xl border border-border/80 bg-surface-1 p-8 shadow-surface-1 text-center flex flex-col items-center justify-center gap-2"
            >
              <Users className="size-8 text-muted-foreground/40 mb-1" />
              <p className="text-sm font-medium text-foreground m-0">暂无项目成员（或无权查看）</p>
              <p className="text-xs text-muted-foreground m-0 break-words">点击上方「添加成员」或「生成邀请」将协作伙伴加入该项目。</p>
            </Elevated>
          ) : filteredRows.length === 0 ? (
            <Elevated
              offset={1}
              shadowLevel={1}
              className="rounded-xl border border-border/80 bg-surface-1 p-8 shadow-surface-1 text-center flex flex-col items-center justify-center gap-2"
            >
              <Users className="size-8 text-muted-foreground/40 mb-1" />
              <p className="text-sm font-medium text-foreground m-0">没有匹配的成员</p>
              <p className="text-xs text-muted-foreground m-0 break-words">换一个角色或 SSH 筛选条件试试，或改回「全部」查看名单。</p>
            </Elevated>
          ) : (
            <ResponsiveList
              table={
                <TableShell>
                  <Table data-testid="member-table" stackOnMobile={false} className="min-w-[700px]">
                    <TableHeader className="sticky top-0 z-20 bg-surface-2/80 backdrop-blur-xs border-b border-border/70 select-none">
                      <TableRow className="border-b border-border/60 hover:bg-transparent">
                        <TableHead className="py-2.5">
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                            <User className="size-3.5 opacity-60 shrink-0" />
                            成员账户
                          </span>
                        </TableHead>
                        <TableHead className="w-[180px] py-2.5">
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                            <Hash className="size-3.5 opacity-60 shrink-0" />
                            用户 ID
                          </span>
                        </TableHead>
                        <TableHead className="w-[220px] py-2.5">
                          <span className="inline-flex items-center gap-1 whitespace-nowrap">
                            <Shield className="size-3.5 opacity-60 shrink-0" />
                            项目角色
                            <Hint label="项目角色与权限说明">
                              <Button
                                type="button"
                                variant="ghost"
                                size="compact"
                                aria-label="项目角色与权限说明"
                                className="size-6 p-0 shrink-0 text-muted-foreground hover:text-foreground"
                                onClick={() => setHelpOpen(true)}
                              >
                                <CircleHelp className="size-3.5 shrink-0" />
                              </Button>
                            </Hint>
                          </span>
                        </TableHead>
                        <TableHead className="w-[140px] py-2.5">
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                            <Terminal className="size-3.5 opacity-60 shrink-0" />
                            SSH 权限
                          </span>
                        </TableHead>
                        <TableHead stickyEnd className="w-[110px] text-right py-2.5 pr-4">
                          <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap w-full">
                            操作
                          </span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pager.slice.map((m) => {
                        const displayName = m.username || userMap[m.user_id];
                        return (
                          <TableRow key={m.user_id} data-testid="member-row">
                            <TableCell className="py-2.5 font-medium whitespace-nowrap">
                              <div className="inline-flex items-center gap-2">
                                <span className="size-6 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-[11px] shrink-0 border border-primary/20">
                                  {(displayName || m.user_id).slice(0, 1).toUpperCase()}
                                </span>
                                <span className="font-medium text-foreground">{displayName || "—"}</span>
                              </div>
                            </TableCell>
                            <TableCell className="mono font-mono text-xs py-2.5 whitespace-nowrap text-muted-foreground">
                              <Hint label={m.user_id}>
                                <span className="cursor-help">{m.user_id.slice(0, 12)}…</span>
                              </Hint>
                            </TableCell>
                            <TableCell className="py-2.5 whitespace-nowrap">
                              {renderRoleControl(m)}
                            </TableCell>
                            <TableCell className="py-2.5 whitespace-nowrap">
                              {renderSshControl(m)}
                            </TableCell>
                            <TableCell stickyEnd className="text-right py-2.5 w-[110px] pr-4">
                              <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                                {m.role !== "owner" && canManage && (
                                  <Button
                                    type="button"
                                    variant="destructive"
                                    size="compact"
                                    data-testid="member-remove"
                                    disabled={busy}
                                    className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-7 text-xs"
                                    onClick={() => void remove(m.user_id, m.role)}
                                  >
                                    <Trash2 className="size-3.5 shrink-0" />
                                    移除
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableShell>
              }
              cards={pager.slice.map((m) => {
                const displayName = m.username || userMap[m.user_id];
                return (
                  <ListCard key={m.user_id} data-testid="member-row">
                    <ListCardHeader
                      leading={
                        <span className="size-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-[11px] shrink-0 border border-primary/20">
                          {(displayName || m.user_id).slice(0, 1).toUpperCase()}
                        </span>
                      }
                      title={displayName || "—"}
                      trailing={renderSshControl(m)}
                    />
                    <ListCardMeta>
                      <Hint label={m.user_id}>
                        <span className="inline-flex items-center gap-1 font-mono cursor-help">
                          <Hash className="size-3 opacity-60 shrink-0" />
                          {m.user_id.slice(0, 8)}…
                        </span>
                      </Hint>
                    </ListCardMeta>
                    <div className="mt-3 min-w-0">
                      {renderRoleControl(m, true)}
                    </div>
                    {m.role !== "owner" && canManage && (
                      <ListCardActions>
                        <Button
                          type="button"
                          variant="destructive"
                          size="compact"
                          data-testid="member-remove"
                          disabled={busy}
                          className="inline-flex items-center gap-1 shrink-0 whitespace-nowrap h-7 text-xs"
                          onClick={() => void remove(m.user_id, m.role)}
                        >
                          <Trash2 className="size-3.5 shrink-0" />
                          移除
                        </Button>
                      </ListCardActions>
                    )}
                  </ListCard>
                );
              })}
            />
          )}
        </div>
      </PageFrame>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent size="lg" className="sm:max-w-xl" data-testid="role-help-dialog">
          <DialogHeader>
            <DialogTitle>项目角色与权限说明</DialogTitle>
            <DialogDescription className="break-words min-w-0">
              角色决定控制台能做什么；SSH 授权决定能不能连工作区。owner / admin 默认可连，不依赖下方开关。
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4 overflow-x-hidden overflow-y-auto max-w-full">
            <div className="grid gap-2">
              <h3 className="m-0 text-xs font-semibold text-foreground">项目角色</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {MEMBER_ROLES.map((role) => (
                  <div
                    key={role}
                    className="p-2.5 rounded-lg border border-border/60 bg-surface-2/40 flex flex-col gap-1 min-w-0"
                  >
                    <span className="inline-flex items-center gap-1.5 text-foreground">
                      <span className="font-medium text-xs">{roleChipLabel(role)}</span>
                      <Hint label={role}>
                        <span className="font-mono text-[11px] text-muted-foreground uppercase tracking-wider cursor-help">
                          {role}
                        </span>
                      </Hint>
                    </span>
                    <span className="text-muted-foreground text-[11px] leading-relaxed break-words min-w-0">
                      {ROLE_HELP[role]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid gap-2">
              <h3 className="m-0 text-xs font-semibold text-foreground">SSH 权限</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SSH_HELP.map((item) => (
                  <div
                    key={item.key}
                    className="p-2.5 rounded-lg border border-border/60 bg-surface-2/40 flex flex-col gap-1 min-w-0"
                  >
                    <span className="text-xs font-medium text-foreground">{memberSshFilterLabel(item.key)}</span>
                    <span className="text-muted-foreground text-[11px] leading-relaxed break-words min-w-0">
                      {item.tip}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setHelpOpen(false)}>
              知道了
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removeId} onOpenChange={(v) => !v && setRemoveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移除项目成员</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <AlertDialogDescription>确认将成员「{removeId}」从当前项目中移除？移除后该成员将失去对该项目及所有服务器的访问权。</AlertDialogDescription>
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="confirm-cancel">取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" data-testid="confirm-ok" onClick={() => void confirmRemove()}>
              确定移除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BatchCreateUsersDialog
        open={batchOpen}
        onOpenChange={setBatchOpen}
        currentProjectId={projectId}
        currentProjectName={projectName}
        onSuccess={load}
      />
    </>
  );
}
