import { FormEvent, useEffect, useId, useState } from "react";
import { useLogin } from "@refinedev/core";
import { useSearchParams } from "react-router-dom";
import { api, friendlyError, type ApiError } from "../providers";
import { Button } from "../ui";

/**
 * Open registration is enabled (POST /auth/register).
 * To disable open signup later: set OPEN_REGISTER = false and hide the panel below.
 */
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
  const [password, setPassword] = useState(import.meta.env.DEV ? "adminadmin" : "");
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
    <div className="login-wrap">
      <form className="card" onSubmit={onLogin} noValidate>
        <h1>ha-cluster</h1>
        <p className="muted">隔离 Workspace · 硬占用账本 · EasyTier</p>
        {import.meta.env.DEV && (
          <p className="env-badge env-badge-inline" title="仅开发构建预填">
            DEV
          </p>
        )}
        <label htmlFor={userId}>
          用户名
          <input
            id={userId}
            name="username"
            autoComplete="username"
            data-testid="login-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label htmlFor={passId}>
          密码
          <input
            id={passId}
            name="password"
            autoComplete="current-password"
            data-testid="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {err && (
          <p className="error" data-testid="login-error" role="alert">
            {err}
          </p>
        )}
        {info && (
          <p className="success" role="status" data-testid="login-info">
            {info}
          </p>
        )}
        <Button data-testid="login-submit" disabled={isLoading} type="submit">
          {isLoading ? "登录中…" : "登录"}
        </Button>

        {OPEN_REGISTER && (
          <div className="register-fold">
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
              <div className="register-panel">
                <label htmlFor={emailId}>
                  邮箱
                  <input
                    id={emailId}
                    name="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </label>
                <p className="muted tiny">将使用上方用户名与密码完成注册</p>
                <Button type="button" disabled={registering} onClick={onRegister}>
                  {registering ? "注册中…" : "创建账号"}
                </Button>
              </div>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
