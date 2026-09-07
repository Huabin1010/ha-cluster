import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Mail } from "lucide-react";
import { api, friendlyError } from "../../providers";
import { ASSIGNABLE_ROLES, ROLE_HELP, roleLabel } from "./roles";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { SelectBox } from "../../components/ui/select";
import { Field } from "../../components/ui/field";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";
import { PageFrame } from "../../components/ui/page-frame";
import { Paginator } from "../../components/ui/pagination";
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
} from "../../components/ui/alert-dialog";
import { Loading } from "../../ui";
import { useClientPager } from "../../lib/use-client-pager";

export type Member = { project_id: string; user_id: string; role: string };

type Props = {
  projectId: string;
  projectName?: string;
};

export function MemberList({ projectId, projectName }: Props) {
  const [rows, setRows] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [addRole, setAddRole] = useState<string>("developer");
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("developer");
  const [inviteToken, setInviteToken] = useState("");
  const [copied, setCopied] = useState<"token" | "link" | "">("");
  const [removeId, setRemoveId] = useState<string | null>(null);
  const pager = useClientPager(rows, projectId);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setErr("");
    try {
      const json = await api<{ data: Member[] }>(`/projects/${projectId}/members`);
      setRows(json.data ?? []);
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
  }, [load]);

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

  async function copyText(kind: "token" | "link", value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
    } catch {
      setErr("复制失败，请手动选中文本");
    }
  }

  if (!projectId) {
    return <p className="text-sm text-muted-foreground">请选择一个项目</p>;
  }

  const tokenBox = inviteToken ? (
    <Alert variant="info" data-testid="invite-token">
      <AlertDescription className="grid gap-3">
        <p className="m-0">把下面的 token 发给对方（或分享带 token 的链接）。对方登录后打开接受页即可加入。</p>
        <code className="mono invite-token-text block break-all rounded-md bg-background p-2 font-mono text-xs">{inviteToken}</code>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" data-testid="invite-copy" onClick={() => void copyText("token", inviteToken)}>
            {copied === "token" ? "已复制 token" : "复制 token"}
          </Button>
          <Button variant="default" size="sm" asChild>
            <Link to={acceptPath} data-testid="invite-accept-link">
              打开接受页
            </Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void copyText("link", `${window.location.origin}${acceptPath}`)}
          >
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
        <div className="grid gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="m-0 text-base font-semibold">{projectName ? `${projectName} · 成员` : "成员"}</h3>
              <p className="mono mt-1 mb-0 font-mono text-xs text-muted-foreground">project: {projectId}</p>
              <p className="mt-1 mb-0 text-sm text-muted-foreground">owner 不可通过此表单转让；添加已存在账号为成员需 admin 权限。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Dialog open={addOpen} onOpenChange={setAddOpen}>
                <DialogTrigger asChild>
                  <Button type="button" data-testid="member-add-open">
                    <Plus className="h-4 w-4" />
                    添加成员
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>添加成员</DialogTitle>
                    <DialogDescription>将已有账号加入本项目。owner 不可通过此表单转让。</DialogDescription>
                  </DialogHeader>
                  <form className="flex min-h-0 flex-1 flex-col" onSubmit={add} data-testid="member-add-form">
                    <DialogBody className="grid gap-4">
                      <Field label="用户名">
                        <Input
                          data-testid="member-username"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          required
                          autoComplete="off"
                        />
                      </Field>
                      <Field label="角色">
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
                      <Button data-testid="member-add" type="submit" disabled={busy}>
                        添加成员
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>

              <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
                <DialogTrigger asChild>
                  <Button type="button" variant="outline" data-testid="invite-open">
                    <Mail className="h-4 w-4" />
                    生成邀请
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>生成邀请</DialogTitle>
                    <DialogDescription>生成 token 发给对方，登录后即可加入。</DialogDescription>
                  </DialogHeader>
                  <form className="flex min-h-0 flex-1 flex-col" onSubmit={invite} data-testid="invite-form">
                    <DialogBody className="grid gap-4">
                      <Field label="邀请邮箱">
                        <Input
                          type="email"
                          data-testid="invite-email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                        />
                      </Field>
                      <Field label="角色">
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
                        生成邀请
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </div>
          {err && (
            <Alert variant="destructive" role="alert" data-testid="member-error">
              <AlertDescription>{err}</AlertDescription>
            </Alert>
          )}
        </div>
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
        <Card data-testid="role-help" aria-label="角色说明">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">角色说明</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="m-0 grid gap-1 pl-4 text-sm text-muted-foreground">
              {Object.entries(ROLE_HELP).map(([role, tip]) => (
                <li key={role}>
                  <code>{role}</code>：{tip}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {loading ? (
          <Loading label="加载中…" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无成员（或无权查看）</p>
        ) : (
          <Table data-testid="member-table">
            <TableHeader>
              <TableRow>
                <TableHead>user_id</TableHead>
                <TableHead>role</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pager.slice.map((m) => (
                <TableRow key={m.user_id} data-testid="member-row">
                  <TableCell className="mono font-mono text-xs">{m.user_id}</TableCell>
                  <TableCell>{roleLabel(m.role)}</TableCell>
                  <TableCell>
                    {m.role !== "owner" && (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        data-testid="member-remove"
                        disabled={busy}
                        onClick={() => void remove(m.user_id, m.role)}
                      >
                        移除
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </PageFrame>
    <AlertDialog open={!!removeId} onOpenChange={(v) => !v && setRemoveId(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>移除成员</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogBody>
          <AlertDialogDescription>确认移除成员 {removeId}？</AlertDialogDescription>
        </AlertDialogBody>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="confirm-cancel">取消</AlertDialogCancel>
          <AlertDialogAction data-testid="confirm-ok" onClick={() => void confirmRemove()}>
            确定
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
