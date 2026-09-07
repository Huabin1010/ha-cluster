export const API_BASE = "/api";

/** Login query when refresh/session died — Login page shows a clear message. */
export const SESSION_EXPIRED_QUERY = "reason=expired";

export type ApiError = Error & { status?: number; statusCode?: number };

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
  if (text) {
    try {
      const data = JSON.parse(text) as { error?: string };
      if (data?.error) msg = data.error;
    } catch {
      msg = text;
    }
  }
  const err: ApiError = new Error(msg);
  // Refine HttpError uses statusCode; keep status for our helpers.
  err.status = res.status;
  err.statusCode = res.status;
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
    }
    const q = qs.toString();
    const json = await api<{ data: unknown[]; total: number }>(`/${resource}${q ? `?${q}` : ""}`);
    const data = json.data ?? json;
    const list = Array.isArray(data) ? data : [];
    return { data: list, total: json.total ?? list.length };
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
      const data = await api(`/projects/${variables.project_id}/workspaces`, {
        method: "POST",
        body: JSON.stringify(variables),
      });
      return { data };
    }
    const data = await api(`/${resource}`, { method: "POST", body: JSON.stringify(variables) });
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
    await api(`/${resource}/${id}`, { method: "DELETE" });
    return { data: { id } };
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

export function isInsufficientCapacity(e: unknown): boolean {
  if (e == null) return false;
  let msg = "";
  if (typeof e === "string") msg = e;
  else if (e instanceof Error) msg = e.message;
  else if (typeof e === "object" && "message" in e) msg = String((e as { message: unknown }).message);
  else msg = String(e);
  return msg === "INSUFFICIENT_CAPACITY" || msg.toLowerCase().includes("insufficient");
}

export function friendlyError(e: unknown): string {
  if (isInsufficientCapacity(e)) {
    return "资源不足，请换套餐或节点（INSUFFICIENT_CAPACITY）";
  }
  if (isApiError(e) && e.status === 401) {
    return "用户名或密码错误";
  }
  if (isApiError(e) && e.status === 403) {
    return "没有权限做这件事";
  }
  if (isApiError(e) && e.status === 404) {
    return "找不到该用户或资源";
  }
  if (isApiError(e) && (e.status === 0 || e.message.includes("network"))) {
    return "网络异常，请稍后重试";
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (msg === "unauthorized" || msg === "Unauthorized") return "用户名或密码错误";
  if (msg === "forbidden") return "没有权限做这件事";
  if (msg === "not found") return "找不到该用户或资源";
  if (msg === "invalid input" || msg === "invalid_input") return "输入无效，请检查后重试";
  if (msg === "conflict") return "与已有资源冲突（如 slug 重复或邀请已使用）";
  if (msg.toLowerCase().includes("conflict")) return "与已有资源冲突";
  return msg;
}

