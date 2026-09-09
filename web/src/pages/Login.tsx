import { FormEvent, useEffect, useId, useState } from "react";
import { useLogin } from "@refinedev/core";
import { useSearchParams } from "react-router-dom";
import { api, friendlyError, type ApiError } from "../providers";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Field } from "../components/ui/field";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Hint } from "../components/ui/tooltip";
import { Separator } from "../components/ui/separator";
import { ThemeToggle } from "../components/theme-toggle";
import { LoginHeroArt } from "./login-hero";

const OPEN_REGISTER = true;

function loginErrorMessage(e: unknown): string {
  const err = e as ApiError & { statusCode?: number };
  const status = err?.status ?? err?.statusCode;
  if (status === 401 || err?.message === "unauthorized") {
    return "用户名或密码错误";
  }
  return friendlyError(e);
}

export function LoginPage() {
  const { mutate, isLoading } = useLogin();
  const [params] = useSearchParams();
  const [username, setUsername] = useState(import.meta.env.DEV ? "admin" : "");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registering, setRegistering] = useState(false);
  const uid = useId();
  const userId = `${uid}-user`;
  const passId = `${uid}-pass`;
  const emailId = `${uid}-email`;

  useEffect(() => {
    if (params.get("reason") === "expired") {
      setInfo("登录已过期，请重新登录");
    }
  }, [params]);

  function onLogin(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setInfo("");
    mutate(
      { username, password },
      {
        onError: (e) => setErr(loginErrorMessage(e)),
      },
    );
  }

  function onRegister() {
    setErr("");
    setInfo("");
    if (!username.trim() || !password || !email.trim()) {
      setErr("请填写用户名、邮箱与密码");
      return;
    }
    setRegistering(true);
    api("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, email, password }),
    })
      .then(() => {
        setRegisterOpen(false);
        setInfo("注册成功，请登录");
      })
      .catch((e) => setErr(friendlyError(e)))
      .finally(() => setRegistering(false));
  }

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <aside className="relative isolate min-h-44 overflow-hidden bg-[#071018] lg:min-h-svh">
        <LoginHeroArt />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#071018]/90 via-transparent to-[#071018]/25" />
        <div className="relative z-10 flex h-full min-h-44 flex-col justify-end p-6 text-white lg:p-12">
          <p className="text-xs tracking-[0.22em] text-white/60 uppercase">ha-cluster</p>
          <h1 className="mt-2 max-w-md text-2xl font-semibold tracking-tight lg:text-4xl">
            把散落的算力织成一台集群
          </h1>
          <p className="mt-3 max-w-sm text-sm text-white/70 lg:text-base">
            隔离 Workspace · 硬占用账本 · EasyTier 组网
          </p>
        </div>
      </aside>

      <section className="relative flex items-center justify-center bg-background p-6 sm:p-10">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-semibold tracking-tight">登录</h2>
              {import.meta.env.DEV && (
                <Hint label="仅开发构建预填">
                  <span className="inline-flex w-fit">
                    <Badge variant="outline" className="w-fit uppercase">
                      DEV
                    </Badge>
                  </span>
                </Hint>
              )}
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">使用账号进入控制台</p>
          </div>

          <form className="grid gap-4" onSubmit={onLogin} noValidate>
            <Field label="用户名" htmlFor={userId}>
              <Input
                id={userId}
                name="username"
                autoComplete="username"
                data-testid="login-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </Field>
            <Field label="密码" htmlFor={passId}>
              <Input
                id={passId}
                name="password"
                autoComplete="current-password"
                data-testid="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            {err && (
              <Alert variant="destructive" data-testid="login-error" role="alert">
                <AlertDescription>{err}</AlertDescription>
              </Alert>
            )}
            {info && (
              <Alert variant="success" role="status" data-testid="login-info">
                <AlertDescription>{info}</AlertDescription>
              </Alert>
            )}
            <Button data-testid="login-submit" disabled={isLoading} type="submit" className="w-full">
              {isLoading ? "登录中…" : "登录"}
            </Button>

            {OPEN_REGISTER && (
              <div className="grid gap-3">
                <Separator />
                <Button
                  type="button"
                  variant="ghost"
                  aria-expanded={registerOpen}
                  onClick={() => {
                    setRegisterOpen((v) => !v);
                    setErr("");
                    setInfo("");
                  }}
                >
                  {registerOpen ? "收起注册" : "没有账号？注册"}
                </Button>
                {registerOpen && (
                  <div className="grid gap-3 rounded-lg border border-dashed border-border p-3">
                    <Field label="邮箱" htmlFor={emailId}>
                      <Input
                        id={emailId}
                        name="email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </Field>
                    <p className="m-0 text-xs text-muted-foreground">将使用上方用户名与密码完成注册</p>
                    <Button type="button" disabled={registering} onClick={onRegister}>
                      {registering ? "注册中…" : "创建账号"}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </form>
        </div>
      </section>
    </div>
  );
}
