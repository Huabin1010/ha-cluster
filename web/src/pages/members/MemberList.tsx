import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, friendlyError } from "../../providers";
import { ASSIGNABLE_ROLES, ROLE_HELP, roleLabel } from "./roles";

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
  const [username, setUsername] = useState("");
  const [addRole, setAddRole] = useState<string>("developer");
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("developer");
  const [inviteToken, setInviteToken] = useState("");
  const [copied, setCopied] = useState<"token" | "link" | "">("");

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
    if (!window.confirm(`确认移除成员 ${userId}？`)) return;
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
    return <p className="muted">请选择一个项目</p>;
  }

  return (
    <div className="members-panel">
      <header className="members-header">
        <h3>{projectName ? `${projectName} · 成员` : "成员"}</h3>
        <p className="muted mono">project: {projectId}</p>
      </header>

      <aside className="role-help" aria-label="角色说明" data-testid="role-help">
        <strong>角色说明</strong>
        <ul>
          {Object.entries(ROLE_HELP).map(([role, tip]) => (
            <li key={role}>
              <code>{role}</code>：{tip}
            </li>
          ))}
        </ul>
      </aside>

      {err && (
        <p className="error" role="alert" data-testid="member-error">
          {err}
        </p>
      )}

      <form className="row wrap" onSubmit={add} data-testid="member-add-form">
        <label>
          用户名
          <input
            data-testid="member-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="off"
          />
        </label>
        <label>
          角色
          <select
            data-testid="member-role"
            value={addRole}
            onChange={(e) => setAddRole(e.target.value)}
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        </label>
        <button data-testid="member-add" type="submit" disabled={busy}>
          添加成员
        </button>
      </form>
      <p className="muted">owner 不可通过此表单转让；添加已存在账号为成员需 admin 权限。</p>

      <form className="row wrap" onSubmit={invite} data-testid="invite-form">
        <label>
          邀请邮箱
          <input
            type="email"
            data-testid="invite-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          角色
          <select
            data-testid="invite-role"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={busy}>
          生成邀请
        </button>
      </form>

      {inviteToken && (
        <div className="invite-box" data-testid="invite-token">
          <p>把下面的 token 发给对方（或分享带 token 的链接）。对方登录后打开接受页即可加入。</p>
          <code className="mono invite-token-text">{inviteToken}</code>
          <div className="row wrap">
            <button
              type="button"
              className="ghost"
              data-testid="invite-copy"
              onClick={() => void copyText("token", inviteToken)}
            >
              {copied === "token" ? "已复制 token" : "复制 token"}
            </button>
            <Link className="btn-link" to={acceptPath} data-testid="invite-accept-link">
              打开接受页
            </Link>
            <button
              type="button"
              className="ghost"
              onClick={() =>
                void copyText(
                  "link",
                  `${window.location.origin}${acceptPath}`,
                )
              }
            >
              {copied === "link" ? "已复制链接" : "复制邀请链接"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="muted">加载中…</p>
      ) : rows.length === 0 ? (
        <p className="muted">暂无成员（或无权查看）</p>
      ) : (
        <table data-testid="member-table">
          <thead>
            <tr>
              <th>user_id</th>
              <th>role</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.user_id} data-testid="member-row">
                <td className="mono">{m.user_id}</td>
                <td>{roleLabel(m.role)}</td>
                <td>
                  {m.role !== "owner" && (
                    <button
                      type="button"
                      className="ghost danger-text"
                      data-testid="member-remove"
                      disabled={busy}
                      onClick={() => void remove(m.user_id, m.role)}
                    >
                      移除
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
