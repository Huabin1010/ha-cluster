export const API_BASE = "/api";

/** Login query when refresh/session died — Login page shows a clear message. */
export const SESSION_EXPIRED_QUERY = "reason=expired";

export type ApiError = Error & { status?: number; statusCode?: number; hint?: string };

export type AuthUser = {
  id: string;
  username: string;
  platform_role?: string;
};

export type TokenResponse = {
  token: string;
  refresh_token?: string;
  user: AuthUser;
};

let refreshing: Promise<boolean> | null = null;

export function clearSession() {
  localStorage.removeItem("ha_token");
  localStorage.removeItem("ha_refresh");
  localStorage.removeItem("ha_user");
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && typeof (e as ApiError).status === "number";
}

function redirectToLogin(reason: "expired" | "logout" = "expired") {
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith("/login")) return;
  const q = reason === "expired" ? `?${SESSION_EXPIRED_QUERY}` : "";
  window.location.assign(`/login${q}`);
}

async function tryRefresh(): Promise<boolean> {
  const refresh = localStorage.getItem("ha_refresh");
  if (!refresh) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) return false;
    const text = await res.text();
    const out = (text ? JSON.parse(text) : {}) as TokenResponse;
    if (!out.token) return false;
    localStorage.setItem("ha_token", out.token);
    if (out.refresh_token) localStorage.setItem("ha_refresh", out.refresh_token);
    if (out.user) localStorage.setItem("ha_user", JSON.stringify(out.user));
    return true;
  } catch {
    return false;
  }
}

/** Shared fetch with Bearer + single 401→refresh retry. */
async function authorizedFetch(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const token = localStorage.getItem("ha_token");
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch (e) {
    const err: ApiError = new Error(e instanceof Error ? e.message : "network error");
    err.status = 0;
    err.statusCode = 0;
    throw err;
  }

  if (res.status === 401 && !retried && !path.startsWith("/auth/")) {
    if (!refreshing) refreshing = tryRefresh().finally(() => { refreshing = null; });
    const ok = await refreshing;
    if (ok) return authorizedFetch(path, init, true);
    clearSession();
    redirectToLogin("expired");
  }
  return res;
}

function throwApiError(res: Response, text: string): never {
  let msg = res.statusText || "request failed";
  let hint = "";
  if (text) {
    try {
      const data = JSON.parse(text) as { error?: string; hint?: string };
      if (data?.error) msg = data.error;
      if (data?.hint) hint = data.hint;
    } catch {
      msg = text;
    }
  }
  if (hint && !msg.includes(hint)) {
    msg = `${msg}。${hint}`;
  }
  const err: ApiError = new Error(msg);
  // Refine HttpError uses statusCode; keep status for our helpers.
  err.status = res.status;
  err.statusCode = res.status;
  if (hint) err.hint = hint;
  throw err;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await authorizedFetch(path, init);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) throwApiError(res, text);
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    const err: ApiError = new Error("invalid json response");
    err.status = res.status;
    err.statusCode = res.status;
    throw err;
  }
}

/** Plain-text endpoints (SSH config) with the same auth/refresh behavior. */
export async function apiText(path: string, init: RequestInit = {}): Promise<string> {
  const res = await authorizedFetch(path, init);
  const text = await res.text();
  if (!res.ok) throwApiError(res, text);
  return text;
}

type ListFilter = { field: string; operator?: string; value?: unknown };

function collectionPath(resource: string): string {
  switch (resource) {
    case "ssh-keys":
      return "/me/ssh-keys";
    case "audit-logs":
      return "/audit-logs";
    case "capacity":
      return "/capacity";
    default:
      return `/${resource}`;
  }
}

export const dataProvider = {
  getList: async ({
    resource,
    filters,
  }: {
    resource: string;
    filters?: ListFilter[];
  }) => {
    const qs = new URLSearchParams();
    for (const f of filters ?? []) {
      if (f.field === "project_id" && f.value != null && String(f.value) !== "") {
        qs.set("project_id", String(f.value));
      }
      if (f.field === "all" && f.value != null && String(f.value) !== "") {
        qs.set("all", String(f.value));
      }
    }
    const q = qs.toString();
    const json = await api<Record<string, unknown>>(`${collectionPath(resource)}${q ? `?${q}` : ""}`);
    if (resource === "capacity") {
      const pools = Array.isArray(json.pools) ? json.pools : [];
      const list = pools.map((p) => {
        const row = (p ?? {}) as Record<string, unknown>;
        return { id: String(row.arch ?? ""), ...row };
      });
      return { data: list, total: list.length };
    }
    const data = json.data ?? json;
    const list = Array.isArray(data) ? data : [];
    return { data: list, total: typeof json.total === "number" ? json.total : list.length };
  },
  getOne: async ({ resource, id }: { resource: string; id: string | number }) => {
    const data = await api(`/${resource}/${id}`);
    return { data };
  },
  create: async ({
    resource,
    variables,
  }: {
    resource: string;
    variables: Record<string, unknown>;
  }) => {
    if (resource === "workspaces") {
      const { project_id, ...payload } = variables;
      const data = await api(`/projects/${project_id}/workspaces`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return { data };
    }
    if (resource === "ssh-keys") {
      const data = await api("/me/ssh-keys", { method: "POST", body: JSON.stringify(variables) });
      return { data };
    }
    const data = await api(collectionPath(resource), { method: "POST", body: JSON.stringify(variables) });
    return { data };
  },
  update: async ({
    resource,
    id,
    variables,
  }: {
    resource: string;
    id: string | number;
    variables: Record<string, unknown>;
  }) => {
    const data = await api(`/${resource}/${id}`, {
      method: "PATCH",
      body: JSON.stringify(variables),
    });
    return { data };
  },
  deleteOne: async ({ resource, id }: { resource: string; id: string | number }) => {
    const path = resource === "ssh-keys" ? `/me/ssh-keys/${id}` : `${collectionPath(resource)}/${id}`;
    await api(path, { method: "DELETE" });
    return { data: { id } };
  },
  custom: async ({
    url,
    method,
    payload,
  }: {
    url: string;
    method: string;
    payload?: unknown;
  }) => {
    const path = url.startsWith("/api") ? url.slice(4) : url;
    const init: RequestInit = { method: method.toUpperCase() };
    if (payload !== undefined && method !== "get" && method !== "head") {
      init.body = JSON.stringify(payload);
    }
    const data = await api(path, init);
    return { data };
  },
  getApiUrl: () => API_BASE,
};

export const authProvider = {
  login: async ({ username, password }: { username: string; password: string }) => {
    const out = await api<TokenResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    localStorage.setItem("ha_token", out.token);
    if (out.refresh_token) localStorage.setItem("ha_refresh", out.refresh_token);
    localStorage.setItem("ha_user", JSON.stringify(out.user));
    return { success: true, redirectTo: "/projects" };
  },
  logout: async () => {
    const refresh = localStorage.getItem("ha_refresh");
    try {
      if (refresh) {
        await api("/auth/logout", { method: "POST", body: JSON.stringify({ refresh_token: refresh }) });
      }
    } catch {
      /* still clear local session */
    }
    clearSession();
    return { success: true, redirectTo: "/login" };
  },
  check: async () => {
    const token = localStorage.getItem("ha_token");
    if (!token) return { authenticated: false, redirectTo: "/login" };
    try {
      const me = await api<AuthUser>("/me");
      localStorage.setItem("ha_user", JSON.stringify(me));
      return { authenticated: true };
    } catch (e) {
      // Only treat hard auth failure as logged-out; keep shell on network/5xx.
      if (isApiError(e) && e.status === 401) {
        clearSession();
        return { authenticated: false, redirectTo: `/login?${SESSION_EXPIRED_QUERY}` };
      }
      if (localStorage.getItem("ha_token")) {
        return { authenticated: true };
      }
      return { authenticated: false, redirectTo: "/login" };
    }
  },
  onError: async (error: { status?: number; statusCode?: number }) => {
    const status = error?.status ?? error?.statusCode;
    if (status === 401) {
      clearSession();
      return { logout: true, redirectTo: `/login?${SESSION_EXPIRED_QUERY}` };
    }
    return {};
  },
  getIdentity: async (): Promise<AuthUser | null> => {
    const raw = localStorage.getItem("ha_user");
    let cached: AuthUser | null = null;
    if (raw) {
      try {
        cached = JSON.parse(raw) as AuthUser;
      } catch {
        /* fall through */
      }
    }
    const token = localStorage.getItem("ha_token");
    if (!token) return null;

    // If cache has platform_role, return cached immediately to avoid layout flicker,
    // while silently refreshing in background to keep permissions up-to-date.
    if (cached?.id && cached?.username && cached.platform_role) {
      void api<AuthUser>("/me")
        .then((me) => {
          if (me) localStorage.setItem("ha_user", JSON.stringify(me));
        })
        .catch(() => {});
      return cached;
    }

    try {
      const me = await api<AuthUser>("/me");
      localStorage.setItem("ha_user", JSON.stringify(me));
      return me;
    } catch {
      return cached;
    }
  },
};

function errorMessage(e: unknown): string {
  if (e == null) return "";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

function attachedHint(e: unknown): string {
  return isApiError(e) && e.hint ? e.hint.trim() : "";
}

/** Drop concatenated API hint / agent coaching so the console never shows it raw. */
function stripAttachedHint(msg: string, hint: string): string {
  let out = msg.trim();
  if (hint && out.endsWith(hint)) {
    out = out.slice(0, out.length - hint.length).replace(/[。.\s]+$/u, "").trim();
  }
  return out;
}

function isInternalCopy(text: string): boolean {
  return /HTTP\s*\d+|不要只看到|不要对着|error 字段|curl\s+-f|confirm_second_port|PATCH\s+\/projects|POST\s+\/workspaces|\$pid|k8s\.invalid/i.test(
    text,
  );
}

function capacityUserMessage(detail: string): string {
  const d = detail.trim();
  if (/超出项目\s*CPU/i.test(d)) {
    return "本次操作将超出项目的 CPU 预算。请降低 CPU 规格，或联系项目管理员调整预算。";
  }
  if (/超出项目内存/.test(d)) {
    return "本次操作将超出项目的内存预算。请降低内存规格，或联系项目管理员调整预算。";
  }
  if (/超出项目磁盘/.test(d)) {
    return "本次操作将超出项目的磁盘预算。请降低磁盘规格，或联系项目管理员调整预算。";
  }
  if (/k3s|k8s|kubernetes/i.test(d)) {
    return "当前没有可调度的 Kubernetes 节点能满足该规格。请改选其他运行环境，或降低规格后重试。";
  }
  if (/arch 匹配|架构匹配/.test(d)) {
    return "当前没有架构匹配且资源充足的节点。请降低规格或更换架构后重试。";
  }
  return "当前节点可用资源不足，无法完成此次操作。请先停止或销毁闲置机器，或改选更低规格。";
}

export function isInsufficientCapacity(e: unknown): boolean {
  if (e == null) return false;
  const msg = errorMessage(e);
  const lower = msg.toLowerCase();
  return (
    msg.includes("INSUFFICIENT_CAPACITY") ||
    lower.includes("insufficient") ||
    msg.includes("资源不足") ||
    msg.includes("可用资源不足")
  );
}

export function friendlyError(e: unknown): string {
  const hint = attachedHint(e);
  const raw = stripAttachedHint(errorMessage(e), hint);

  if (isInsufficientCapacity(e) || /^INSUFFICIENT_CAPACITY\b/i.test(raw)) {
    const extra = raw.replace(/^INSUFFICIENT_CAPACITY:?\s*/i, "").trim();
    const detail = extra && extra.toLowerCase() !== "insufficient_capacity" && extra !== raw ? extra : "";
    return capacityUserMessage(isInternalCopy(detail) ? "" : detail);
  }
  if (isApiError(e) && e.status === 401) {
    return "用户名或密码错误";
  }
  if (isApiError(e) && e.status === 403) {
    return "没有权限执行此操作";
  }
  if (isApiError(e) && e.status === 404) {
    return "未找到该资源";
  }
  if (isApiError(e) && (e.status === 0 || e.message.includes("network"))) {
    return "网络异常，请稍后重试";
  }
  if (raw === "SECOND_PORT_CONFIRM_REQUIRED" || raw.startsWith("SECOND_PORT_CONFIRM_REQUIRED:")) {
    return "该主机已占用一个服务端口。如需托管多个站点，请在主机内配置反向代理。";
  }
  if (raw === "PURPOSE_REQUIRED" || raw.startsWith("PURPOSE_REQUIRED:")) {
    return "请先在项目设置中填写用途后再继续。";
  }
  if (raw === "DISK_SHRINK_NOT_SUPPORTED" || raw.startsWith("DISK_SHRINK_NOT_SUPPORTED")) {
    return "磁盘容量不支持缩减，请只申请更大的磁盘。";
  }
  if (raw === "ONLY_EXPANSION" || raw.startsWith("ONLY_EXPANSION")) {
    return "仅支持扩容：CPU、内存与磁盘均不可下调。";
  }
  if (raw === "EXEC_UNAVAILABLE" || raw.startsWith("EXEC_UNAVAILABLE:")) {
    return "目标机器暂时无法连接。请先启动后再试；若仍失败，请更换节点。";
  }
  if (raw === "K8S_UNAVAILABLE" || raw.startsWith("K8S_UNAVAILABLE:")) {
    return "Kubernetes 控制面暂不可用，请稍后重试。";
  }
  if (raw === "unauthorized" || raw === "Unauthorized") return "用户名或密码错误";
  if (raw === "forbidden") return "没有权限执行此操作";
  if (raw === "not found") return "未找到该资源";
  if (raw === "invalid input" || raw === "invalid_input" || raw.startsWith("invalid input:")) {
    return "提交内容无效，请检查必填项与格式后重试。";
  }
  if (raw === "conflict") {
    return "该操作与现有资源冲突，请检查名称是否重复或当前状态后重试。";
  }
  if (/^conflict:\s*/i.test(raw)) {
    const detail = raw.replace(/^conflict:\s*/i, "").trim();
    if (detail && !isInternalCopy(detail)) return detail;
    return "该操作与现有资源冲突，请检查名称是否重复或当前状态后重试。";
  }
  if (hint && !isInternalCopy(hint) && !raw.includes(hint)) {
    return `${raw}。${hint}`;
  }
  return raw;
}

