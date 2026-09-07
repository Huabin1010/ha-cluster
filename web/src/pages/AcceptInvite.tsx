import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, friendlyError } from "../providers";

/**
 * 接受邀请（U3）：输入 token → POST /invitations/accept → 跳项目详情。
 */
export function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState(searchParams.get("token") ?? "");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    const q = searchParams.get("token");
    if (q) setToken(q);
  }, [searchParams]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setOk("");
    setBusy(true);
    try {
      // 记录接受前的项目列表，以便在后端未返回 project_id 时定位新加入的项目
      const before = await api<{ data: Array<{ id: string }> }>("/projects").catch(() => null);
      const beforeIds = new Set(before?.data?.map((p) => p.id) ?? []);

      const out = await api<{ status: string; project_id?: string }>("/invitations/accept", {
        method: "POST",
        body: JSON.stringify({ token: token.trim() }),
      });
      setOk("邀请已接受");
      let pid = out.project_id;
      if (!pid) {
        const after = await api<{ data: Array<{ id: string }> }>("/projects").catch(() => null);
        const newProj = after?.data?.find((p) => !beforeIds.has(p.id));
        if (newProj) {
          pid = newProj.id;
        } else if (after?.data && after.data.length > 0) {
          pid = after.data[after.data.length - 1].id;
        }
      }
      timer.current = window.setTimeout(() => {
        // 验收：另一用户接受后能看到该项目
        if (pid) navigate(`/projects/${pid}`);
        else navigate("/projects");
      }, 300);
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>接受邀请</h2>
      <p className="muted">
        粘贴管理员发给你的邀请 token。需已登录；未登录请先 <Link to="/login">登录</Link>。
      </p>
      <form className="card accept-card" onSubmit={onSubmit}>
        <label>
          邀请 token
          <input
            data-testid="accept-token"
            className="mono"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
            autoComplete="off"
            placeholder="粘贴 token"
          />
        </label>
        {err && (
          <p className="error" role="alert" data-testid="accept-error">
            {err}
          </p>
        )}
        {ok && (
          <p className="success" data-testid="accept-ok">
            {ok}，正在跳转到项目…
          </p>
        )}
        <button data-testid="accept-submit" type="submit" disabled={busy || !token.trim()}>
          {busy ? "提交中…" : "接受邀请"}
        </button>
        <Link className="muted" to="/members">
          返回成员页
        </Link>
      </form>
    </section>
  );
}
