import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, friendlyError } from "../providers";
import { PageHeader } from "../ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Field } from "../components/ui/field";
import { Card, CardContent } from "../components/ui/card";
import { Alert, AlertDescription } from "../components/ui/alert";

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
    <section className="grid gap-4">
      <PageHeader title="接受邀请" description="粘贴管理员发给你的邀请 token。需已登录。" />
      <p className="m-0 -mt-2 text-sm text-muted-foreground">
        未登录请先{" "}
        <Button variant="link" className="h-auto p-0" asChild>
          <Link to="/login">登录</Link>
        </Button>
        。
      </p>
      <Card className="max-w-lg">
        <CardContent className="pt-6">
          <form className="grid gap-4" onSubmit={onSubmit}>
            <Field label="邀请 token">
              <Input
                data-testid="accept-token"
                className="mono font-mono"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
                autoComplete="off"
                placeholder="粘贴 token"
              />
            </Field>
            {err && (
              <Alert variant="destructive" role="alert" data-testid="accept-error">
                <AlertDescription>{err}</AlertDescription>
              </Alert>
            )}
            {ok && (
              <Alert variant="success" data-testid="accept-ok">
                <AlertDescription>
                  {ok}，正在跳转到项目…
                </AlertDescription>
              </Alert>
            )}
            <Button data-testid="accept-submit" type="submit" disabled={busy || !token.trim()}>
              {busy ? "提交中…" : "接受邀请"}
            </Button>
            <Button variant="link" className="h-auto w-fit p-0" asChild>
              <Link to="/members">返回成员页</Link>
            </Button>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
