import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { api, friendlyError } from "@/providers";
import { PageHeader } from "@/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Elevated } from "@/lib/elevated";
import { spring } from "@/lib/springs";

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
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring.moderate}
      className="grid gap-6 max-w-xl"
    >
      <div>
        <PageHeader
          title="接受邀请"
          description="粘贴项目管理员签发的邀请 Token 即可加入协作项目。需当前已登录。"
        />
        <p className="m-0 mt-2 text-xs text-muted-foreground sm:text-sm">
          未登录请先{" "}
          <Button variant="link" className="h-auto p-0 text-xs sm:text-sm font-medium" asChild>
            <Link to="/login">登录账号</Link>
          </Button>
          。
        </p>
      </div>

      <Elevated
        offset={2}
        shadowLevel={3}
        className="rounded-2xl border border-border/80 bg-surface-2 p-6 sm:p-8 shadow-surface-3 transition-colors duration-150"
      >
        <form className="grid gap-5" onSubmit={onSubmit}>
          <Field label="邀请 Token">
            <Input
              data-testid="accept-token"
              className="mono font-mono text-xs sm:text-sm tracking-tight"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              autoComplete="off"
              placeholder="粘贴邀请 Token"
            />
          </Field>

          <AnimatePresence mode="wait">
            {err && (
              <motion.div
                key="accept-err"
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98, transition: spring.fast.exit }}
                transition={spring.fast}
              >
                <Alert variant="destructive" role="alert" data-testid="accept-error">
                  <AlertDescription>{err}</AlertDescription>
                </Alert>
              </motion.div>
            )}
            {ok && (
              <motion.div
                key="accept-ok"
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98, transition: spring.fast.exit }}
                transition={spring.fast}
              >
                <Alert variant="success" data-testid="accept-ok">
                  <AlertDescription>
                    {ok}，正在跳转至对应项目…
                  </AlertDescription>
                </Alert>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
            <Button
              data-testid="accept-submit"
              type="submit"
              disabled={busy || !token.trim()}
              className="w-full sm:w-auto font-medium"
            >
              {busy ? "提交中…" : "确认接受邀请"}
            </Button>
            <Button variant="ghost" className="text-xs text-muted-foreground hover:text-foreground" asChild>
              <Link to="/members">返回成员页</Link>
            </Button>
          </div>
        </form>
      </Elevated>
    </motion.section>
  );
}
