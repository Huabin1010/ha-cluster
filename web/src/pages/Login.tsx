import { FormEvent, useEffect, useId, useState } from "react";
import { useLogin } from "@refinedev/core";
import { useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { api, friendlyError, type ApiError } from "@/providers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Hint } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { Elevated } from "@/lib/elevated";
import { spring } from "@/lib/springs";
import { LoginHeroArt } from "./login-hero";
import { HaLogo } from "@/components/brand/HaLogo";

const OPEN_REGISTER = true;

function loginErrorMessage(e: unknown): string {
  const err = e as ApiError & { statusCode?: number };
  const status = err?.status ?? err?.statusCode;
  if (status === 401 || err?.message === "unauthorized") {
    return "用户名或密码错误";
  }
  return friendlyError(e);
}

const isDevMode =
  import.meta.env.DEV ||
  (typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "::1"));

export function LoginPage() {
  const { mutate, isLoading } = useLogin();
  const [params] = useSearchParams();
  const [username, setUsername] = useState(isDevMode ? "admin" : "");
  const [password, setPassword] = useState(isDevMode ? "123456qq" : "");
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

  function onDevAdminLogin() {
    setErr("");
    setInfo("");
    setUsername("admin");
    setPassword("123456qq");
    mutate(
      { username: "admin", password: "123456qq" },
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
    <div className="relative min-h-svh flex flex-col justify-center lg:grid lg:grid-cols-2 bg-background selection:bg-sky-500/20">
      {/* Decorative Visual Pane (Desktop full-screen left pane) */}
      <aside className="relative isolate hidden overflow-hidden bg-[#04090e] lg:flex lg:flex-col lg:justify-end lg:min-h-svh">
        <LoginHeroArt />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#04090e]/95 via-transparent to-[#04090e]/30" />
        <div className="relative z-10 flex h-full flex-col justify-end p-8 lg:p-12 text-white">
          <div className="flex items-center gap-2.5">
            <HaLogo size={22} tone="brand" />
            <p className="text-xs font-semibold tracking-[0.24em] text-white/80 uppercase">ha-cluster</p>
          </div>
          <h1 className="mt-3 max-w-md text-2xl font-semibold tracking-tight text-white sm:text-3xl lg:text-4xl">
            把散落的算力织成一台集群
          </h1>
          <p className="mt-3 max-w-sm text-xs leading-relaxed text-white/70 sm:text-sm lg:text-base">
            隔离 Workspace · 硬占用账本 · EasyTier 组网
          </p>
        </div>
      </aside>

      {/* Form Pane with Elevated Card (Adaptive mobile & desktop) */}
      <section className="relative flex flex-1 items-center justify-center p-4 sm:p-8 lg:p-12 overflow-y-auto">
        <div className="absolute top-3.5 right-3.5 z-30 sm:top-5 sm:right-5">
          <ThemeToggle />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring.slow}
          className="w-full max-w-[400px] py-4 sm:py-0"
        >
          {/* Mobile-only compact brand header */}
          <div className="mb-5 flex flex-col items-center text-center lg:hidden">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-surface-2/90 px-3 py-1 shadow-sm backdrop-blur-md">
              <HaLogo size={16} className="text-foreground" />
              <span className="text-[11px] font-semibold tracking-[0.2em] text-foreground/80 uppercase">
                ha-cluster
              </span>
            </div>
            <h1 className="mt-2.5 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              把散落的算力织成一台集群
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              隔离 Workspace · 硬占用账本 · EasyTier 组网
            </p>
          </div>

          <Elevated
            offset={1}
            shadowLevel={3}
            className="rounded-2xl border border-border/80 bg-surface-1 p-5 sm:p-8 shadow-surface-3 transition-colors duration-150"
          >
            <div className="mb-6">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">登录</h2>
                {isDevMode && (
                  <Hint label="点击可一键免密登录管理员账号 (admin)">
                    <button
                      type="button"
                      onClick={onDevAdminLogin}
                      className="inline-flex cursor-pointer transition-transform active:scale-95 focus:outline-none"
                    >
                      <Badge variant="outline" className="w-fit text-[11px] font-medium uppercase tracking-wider hover:bg-surface-2">
                        DEV · 快速登录
                      </Badge>
                    </button>
                  </Hint>
                )}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground sm:text-sm">
                进入集群控制台管理服务器与算力
              </p>
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
                  placeholder="输入用户名"
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
                  placeholder="输入密码"
                  required
                />
              </Field>

              <AnimatePresence mode="wait">
                {err && (
                  <motion.div
                    key="err"
                    initial={{ opacity: 0, y: -4, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98, transition: spring.fast.exit }}
                    transition={spring.fast}
                  >
                    <Alert variant="destructive" data-testid="login-error" role="alert">
                      <AlertDescription>{err}</AlertDescription>
                    </Alert>
                  </motion.div>
                )}
                {info && (
                  <motion.div
                    key="info"
                    initial={{ opacity: 0, y: -4, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98, transition: spring.fast.exit }}
                    transition={spring.fast}
                  >
                    <Alert variant="success" role="status" data-testid="login-info">
                      <AlertDescription>{info}</AlertDescription>
                    </Alert>
                  </motion.div>
                )}
              </AnimatePresence>

              <Button
                data-testid="login-submit"
                disabled={isLoading}
                type="submit"
                className="w-full h-10 sm:h-9 text-sm font-semibold tracking-wide shadow-sm"
              >
                {isLoading ? "登录中…" : "登录"}
              </Button>

              {isDevMode && (
                <Button
                  data-testid="login-dev-submit"
                  type="button"
                  variant="secondary"
                  disabled={isLoading}
                  onClick={onDevAdminLogin}
                  className="w-full h-10 sm:h-9 text-xs font-semibold tracking-wide border border-border/80 text-foreground"
                >
                  ⚡ 一键登录管理员 (Dev)
                </Button>
              )}

              {OPEN_REGISTER && (
                <div className="grid gap-3 pt-1">
                  <Separator />
                  <Button
                    type="button"
                    variant="ghost"
                    data-testid="login-register-open"
                    aria-expanded={registerOpen}
                    onClick={() => {
                      setRegisterOpen((v) => !v);
                      setErr("");
                      setInfo("");
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    {registerOpen ? "收起注册" : "没有账号？注册"}
                  </Button>

                  <AnimatePresence initial={false}>
                    {registerOpen && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0, transition: spring.moderate.exit }}
                        transition={spring.moderate}
                        className="overflow-hidden"
                      >
                        <div className="grid gap-3 rounded-xl border border-dashed border-border/80 bg-surface-2/60 p-4">
                          <Field label="邮箱" htmlFor={emailId}>
                            <Input
                              id={emailId}
                              name="email"
                              type="email"
                              autoComplete="email"
                              data-testid="login-register-email"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              placeholder="name@example.com"
                              required
                            />
                          </Field>
                          <p className="m-0 text-[11px] text-muted-foreground">
                            将使用上方填写的用户名与密码创建账号
                          </p>
                          <Button
                            type="button"
                            variant="secondary"
                            data-testid="login-register-submit"
                            disabled={registering}
                            onClick={onRegister}
                            className="w-full text-xs font-medium"
                          >
                            {registering ? "注册中…" : "创建账号"}
                          </Button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </form>
          </Elevated>
        </motion.div>
      </section>
    </div>
  );
}
