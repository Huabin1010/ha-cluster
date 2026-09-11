import { FormEvent, useEffect, useState } from "react";
import { Ban, Check, CheckCircle2, Copy, KeyRound, Settings2, Trash2, User, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { api, friendlyError } from "@/providers";
import { ASSIGNABLE_ROLES, roleLabel } from "@/pages/members/roles";
import { ASSIGNABLE_PLATFORM_ROLES, platformRoleLabel, userStatusLabel } from "@/pages/users/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SelectBox } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Hint } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { copyText } from "@/ui/format";

export type UserProject = {
  id: string;
  name: string;
  slug?: string;
  role: string;
};

export type PlatformUser = {
  id: string;
  username: string;
  email?: string;
  platform_role?: string;
  status?: string;
  created_at?: string;
  projects?: UserProject[];
};

export type Project = { id: string; name: string; slug: string };

export type ActionKind = "configure" | "reset" | "delete" | "add";

export function UserRowActions({
  user,
  isSelf,
  onAction,
}: {
  user: PlatformUser;
  isSelf?: boolean;
  onAction: (kind: Exclude<ActionKind, "add">, user: PlatformUser) => void;
}) {
  const selfHint = "不能操作当前登录账号";

  return (
    <div className="inline-flex items-center justify-end gap-1 whitespace-nowrap shrink-0">
        <Hint label={isSelf ? selfHint : "配置账号"}>
          <span className="inline-flex">
            <Button
              type="button"
              variant="outline"
              size="compact"
              data-testid="users-configure"
              disabled={isSelf}
              className="size-7 p-0 shrink-0"
              onClick={() => onAction("configure", user)}
            >
              <Settings2 className="size-3.5 shrink-0" />
            </Button>
          </span>
        </Hint>
        <Hint label={isSelf ? selfHint : "重置密码"}>
          <span className="inline-flex">
            <Button
              type="button"
              variant="outline"
              size="compact"
              data-testid="users-reset-password"
              disabled={isSelf}
              className="size-7 p-0 shrink-0"
              onClick={() => onAction("reset", user)}
            >
              <KeyRound className="size-3.5 shrink-0" />
            </Button>
          </span>
        </Hint>
        <Hint label={isSelf ? selfHint : "删除用户"}>
          <span className="inline-flex">
            <Button
              type="button"
              variant="destructive"
              size="compact"
              data-testid="users-delete"
              disabled={isSelf}
              className="size-7 p-0 shrink-0"
              onClick={() => onAction("delete", user)}
            >
              <Trash2 className="size-3.5 shrink-0" />
            </Button>
          </span>
        </Hint>
    </div>
  );
}

export function UserActionDialogs({
  user,
  action,
  projects,
  onActionChange,
  onChanged,
}: {
  user: PlatformUser | null;
  action: ActionKind | null;
  projects: Project[];
  onActionChange: (action: ActionKind | null, user?: PlatformUser | null) => void;
  onChanged: () => void;
}) {
  return (
    <>
      <ConfigureUserDialog
        user={action === "configure" ? user : null}
        onOpenChange={(v) => {
          if (!v) onActionChange(null);
        }}
        onChanged={onChanged}
        onAddToProject={() => onActionChange("add", user)}
      />
      <AddToProjectDialog
        user={action === "add" ? user : null}
        projects={projects}
        onOpenChange={(v) => {
          if (!v) onActionChange(null);
        }}
        onAdded={onChanged}
      />
      <ResetPasswordDialog
        user={action === "reset" ? user : null}
        onOpenChange={(v) => {
          if (!v) onActionChange(null);
        }}
      />
      <DeleteUserDialog
        user={action === "delete" ? user : null}
        onOpenChange={(v) => {
          if (!v) onActionChange(null);
        }}
        onDeleted={onChanged}
      />
    </>
  );
}

function ConfigureUserDialog({
  user,
  onOpenChange,
  onChanged,
  onAddToProject,
}: {
  user: PlatformUser | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  onAddToProject: () => void;
}) {
  const [role, setRole] = useState("platform_user");
  const [busy, setBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setRole(user?.platform_role || "platform_user");
    setErr("");
  }, [user?.id, user?.platform_role]);

  async function saveRole(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setErr("");
    try {
      await api(`/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ platform_role: role }),
      });
      toast.success(`已将 ${user.username} 设为${platformRoleLabel(role)}`);
      onChanged();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus() {
    if (!user) return;
    const suspend = user.status !== "suspended";
    setStatusBusy(true);
    setErr("");
    try {
      await api(`/users/${user.id}/${suspend ? "suspend" : "unsuspend"}`, { method: "POST", body: "{}" });
      toast.success(suspend ? `已停用 ${user.username}` : `已恢复 ${user.username}`);
      onChanged();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setStatusBusy(false);
    }
  }

  const suspended = user?.status === "suspended";

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="sm:max-w-lg" data-testid="users-configure-dialog">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <Settings2 className="size-5 text-primary shrink-0" />
            配置账号
          </DialogTitle>
          <DialogDescription className="break-words min-w-0">
            调整平台角色、停用或恢复账号。把用户加入项目不会新建账号。
          </DialogDescription>
        </DialogHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={saveRole} data-testid="users-configure-form">
          <DialogBody className="grid gap-4 overflow-x-hidden overflow-y-auto max-w-full">
            {err && (
              <Alert variant="destructive">
                <AlertDescription>{err}</AlertDescription>
              </Alert>
            )}
            <Field label="用户">
              <div className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm text-foreground">
                <User className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="font-medium">{user?.username}</span>
                {user?.email ? <span className="text-muted-foreground truncate">{user.email}</span> : null}
              </div>
            </Field>
            <Field label="平台角色">
              <SelectBox
                testId="users-configure-role"
                value={role}
                onValueChange={setRole}
                options={ASSIGNABLE_PLATFORM_ROLES.map((r) => ({ value: r, label: platformRoleLabel(r) }))}
              />
            </Field>
            <Field label="账号状态">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <Hint label={user?.status || "—"} className="font-mono">
                  {suspended ? (
                    <Badge variant="danger" className="inline-flex items-center whitespace-nowrap shrink-0">
                      {userStatusLabel(user?.status)}
                    </Badge>
                  ) : (
                    <Badge variant="ok" className="inline-flex items-center whitespace-nowrap shrink-0">
                      {userStatusLabel(user?.status)}
                    </Badge>
                  )}
                </Hint>
                <Button
                  type="button"
                  variant={suspended ? "outline" : "destructive"}
                  size="compact"
                  data-testid="users-toggle-status"
                  disabled={statusBusy}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 h-7 text-xs"
                  onClick={() => void toggleStatus()}
                >
                  {suspended ? <CheckCircle2 className="size-3.5 shrink-0" /> : <Ban className="size-3.5 shrink-0" />}
                  {statusBusy ? "处理中…" : suspended ? "恢复账号" : "停用账号"}
                </Button>
              </div>
            </Field>
            <Field label="加入项目">
              <p className="m-0 mb-2 text-sm text-muted-foreground break-words min-w-0">
                把该账号加入已有项目，成为项目成员。项目内加人仍可走「成员」页。
              </p>
              <Button
                type="button"
                variant="outline"
                size="compact"
                data-testid="users-add-to-project"
                className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 h-7 text-xs"
                onClick={onAddToProject}
              >
                <UserPlus className="size-3.5 shrink-0" />
                加入项目
              </Button>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
            <Button data-testid="users-configure-submit" type="submit" disabled={busy}>
              {busy ? "保存中…" : "保存角色"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddToProjectDialog({
  user,
  projects,
  onOpenChange,
  onAdded,
}: {
  user: PlatformUser | null;
  projects: Project[];
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}) {
  const [projectId, setProjectId] = useState("");
  const [role, setRole] = useState("developer");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setProjectId("");
    setRole("developer");
    setErr("");
  }, [user?.id]);

  const joined = new Set((user?.projects ?? []).map((p) => p.id));
  const available = projects.filter((p) => !joined.has(p.id));

  function handleOpenChange(open: boolean) {
    if (!open) {
      setProjectId("");
      setRole("developer");
      setErr("");
    }
    onOpenChange(open);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user || !projectId) {
      setErr("请选择要加入的项目");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await api(`/projects/${projectId}/members`, {
        method: "POST",
        body: JSON.stringify({ username: user.username, role }),
      });
      const name = projects.find((p) => p.id === projectId)?.name || projectId;
      toast.success(`已将 ${user.username} 加入「${name}」`);
      handleOpenChange(false);
      onAdded();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={handleOpenChange}>
      <DialogContent size="lg" className="sm:max-w-lg" data-testid="users-add-dialog">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <UserPlus className="size-5 text-primary shrink-0" />
            加入项目
          </DialogTitle>
          <DialogDescription className="break-words min-w-0">
            把已有账号加入指定项目，成为该项目成员。不会新建账号。
          </DialogDescription>
        </DialogHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit} data-testid="users-add-form">
          <DialogBody className="grid gap-4 overflow-x-hidden overflow-y-auto max-w-full">
            {err && (
              <Alert variant="destructive">
                <AlertDescription>{err}</AlertDescription>
              </Alert>
            )}
            <Field label="用户">
              <div className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm text-foreground">
                <User className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="font-medium">{user?.username}</span>
                {user?.email ? <span className="text-muted-foreground truncate">{user.email}</span> : null}
              </div>
            </Field>
            <Field label="目标项目">
              {available.length === 0 ? (
                <p className="m-0 text-sm text-muted-foreground break-words min-w-0">
                  {projects.length === 0 ? "平台上还没有项目。" : "该用户已加入当前可见的全部项目。"}
                </p>
              ) : (
                <SelectBox
                  testId="users-add-project"
                  value={projectId || "__none__"}
                  onValueChange={(v) => setProjectId(v === "__none__" ? "" : v)}
                  placeholder="选择项目"
                  options={[
                    { value: "__none__", label: "— 选择项目 —" },
                    ...available.map((p) => ({
                      value: p.id,
                      label: p.slug ? `${p.name} (${p.slug})` : p.name,
                    })),
                  ]}
                />
              )}
            </Field>
            <Field label="项目角色">
              <SelectBox
                testId="users-add-role"
                value={role}
                onValueChange={setRole}
                options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              取消
            </Button>
            <Button data-testid="users-add-submit" type="submit" disabled={busy || !projectId || available.length === 0}>
              {busy ? "加入中…" : "加入项目"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  user,
  onOpenChange,
}: {
  user: PlatformUser | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [password, setPassword] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setBusy(false);
    setErr("");
    setPassword("");
    setCopied(false);
  }, [user?.id]);

  async function generate() {
    if (!user) return;
    setBusy(true);
    setErr("");
    try {
      const res = await api<{ password: string }>(`/users/${user.id}/reset-password`, {
        method: "POST",
        body: "{}",
      });
      setPassword(res.password);
      toast.success(`已重置 ${user.username} 的密码，现有登录已失效`);
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyPassword() {
    const ok = await copyText(password);
    if (!ok) {
      toast.error("复制失败，请手动选中");
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
    toast.success("新密码已复制");
  }

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="sm:max-w-lg" data-testid="users-reset-dialog">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <KeyRound className="size-5 text-primary shrink-0" />
            重置密码
          </DialogTitle>
          <DialogDescription className="break-words min-w-0">
            将为「{user?.username}」生成新密码，现有登录会话会立即失效。新密码只显示一次，请立刻复制交给对方。
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4 overflow-x-hidden overflow-y-auto max-w-full">
          {err && (
            <Alert variant="destructive">
              <AlertDescription>{err}</AlertDescription>
            </Alert>
          )}
          {password ? (
            <Field label="新密码">
              <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0 flex-1 flex h-9 items-center rounded-lg border border-border px-3 font-mono text-sm text-foreground truncate">
                  {password}
                </div>
                <Hint label={copied ? "已复制" : "复制密码"}>
                  <Button
                    type="button"
                    variant="outline"
                    size="compact"
                    data-testid="users-reset-copy"
                    className="size-9 p-0 shrink-0"
                    onClick={() => void copyPassword()}
                  >
                    {copied ? <Check className="size-3.5 text-emerald-500 shrink-0" /> : <Copy className="size-3.5 shrink-0" />}
                  </Button>
                </Hint>
              </div>
            </Field>
          ) : (
            <p className="m-0 text-sm text-muted-foreground break-words min-w-0">
              确认后系统会随机生成 12 位密码，旧密码立即失效。
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {password ? "完成" : "取消"}
          </Button>
          {!password && (
            <Button data-testid="users-reset-submit" type="button" disabled={busy} onClick={() => void generate()}>
              {busy ? "生成中…" : "生成新密码"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteUserDialog({
  user,
  onOpenChange,
  onDeleted,
}: {
  user: PlatformUser | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!user) return;
    setBusy(true);
    try {
      await api(`/users/${user.id}`, { method: "DELETE" });
      toast.success(`已删除用户 ${user.username}`);
      onOpenChange(false);
      onDeleted();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={!!user} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="users-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>删除用户</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogBody>
          <AlertDialogDescription className="break-words min-w-0">
            确定删除账号「{user?.username}」？删除后无法登录，SSH 公钥与项目成员关系会一并清除。若该用户仍是项目负责人，请先转让所有权。
          </AlertDialogDescription>
        </AlertDialogBody>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="confirm-cancel">取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            data-testid="confirm-ok"
            loading={busy}
            onClick={(e) => {
              e.preventDefault();
              void confirm();
            }}
          >
            删除用户
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
