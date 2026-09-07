import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { api, dataProvider, authProvider, clearSession, isApiError } from "./providers";

describe("dataProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("maps getList envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [{ id: "1" }], total: 1 }),
      })),
    );
    const r = await dataProvider.getList({ resource: "projects" });
    expect(r.total).toBe(1);
    expect(r.data).toHaveLength(1);
  });

  it("getList passes project_id filter", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(String(url)).toContain("/workspaces?project_id=p1");
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [], total: 0 }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    await dataProvider.getList({
      resource: "workspaces",
      filters: [{ field: "project_id", operator: "eq", value: "p1" }],
    });
  });

  it("posts workspace under project", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("/projects/p1/workspaces");
      return { ok: true, status: 201, text: async () => JSON.stringify({ id: "w1" }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await dataProvider.create({
      resource: "workspaces",
      variables: { project_id: "p1", plan: "large" },
    });
    expect((r.data as { id: string }).id).toBe("w1");
  });

  it("getOne and update projects", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/projects/p1") && (!init?.method || init.method === "GET")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: "p1", name: "Demo", slug: "demo" }),
        };
      }
      expect(init?.method).toBe("PATCH");
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ id: "p1", name: "Demo", slug: "demo", budget_mem_bytes: 1024 }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const one = await dataProvider.getOne({ resource: "projects", id: "p1" });
    expect((one.data as { slug: string }).slug).toBe("demo");
    const upd = await dataProvider.update({
      resource: "projects",
      id: "p1",
      variables: { budget_mem_bytes: 1024 },
    });
    expect((upd.data as { budget_mem_bytes: number }).budget_mem_bytes).toBe(1024);
  });
});

describe("authProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("stores token and refresh on login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            token: "abc",
            refresh_token: "ref",
            user: { id: "u", username: "a" },
          }),
      })),
    );
    const r = await authProvider.login({ username: "a", password: "p" });
    expect(r.success).toBe(true);
    expect(r.redirectTo).toBe("/projects");
    expect(localStorage.getItem("ha_token")).toBe("abc");
    expect(localStorage.getItem("ha_refresh")).toBe("ref");
  });

  it("unauthenticated without token", async () => {
    const r = await authProvider.check();
    expect(r.authenticated).toBe(false);
  });

  it("check hits /me when token present", async () => {
    localStorage.setItem("ha_token", "tok");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toContain("/me");
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: "u", username: "alice" }),
        };
      }),
    );
    const r = await authProvider.check();
    expect(r.authenticated).toBe(true);
    expect(JSON.parse(localStorage.getItem("ha_user")!).username).toBe("alice");
  });

  it("check keeps session on transient /me failure", async () => {
    localStorage.setItem("ha_token", "tok");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        text: async () => JSON.stringify({ error: "unavailable" }),
      })),
    );
    const r = await authProvider.check();
    expect(r.authenticated).toBe(true);
    expect(localStorage.getItem("ha_token")).toBe("tok");
  });

  it("check clears session only on 401 from /me", async () => {
    localStorage.setItem("ha_token", "tok");
    localStorage.setItem("ha_refresh", "ref");
    // /me → 401, then refresh fails → clear
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: "unauthorized" }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: "unauthorized" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("location", { pathname: "/projects", assign: vi.fn() });
    const r = await authProvider.check();
    expect(r.authenticated).toBe(false);
    expect(String(r.redirectTo)).toContain("reason=expired");
    expect(localStorage.getItem("ha_token")).toBeNull();
  });

  it("logout posts refresh then clears storage", async () => {
    localStorage.setItem("ha_token", "tok");
    localStorage.setItem("ha_refresh", "ref");
    localStorage.setItem("ha_user", "{}");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 204,
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await authProvider.logout();
    expect(r.redirectTo).toBe("/login");
    expect(localStorage.getItem("ha_token")).toBeNull();
    expect(fetchMock).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("ref");
  });
});

describe("api session refresh", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearSession();
  });

  it("retries once after successful refresh on 401", async () => {
    localStorage.setItem("ha_token", "old");
    localStorage.setItem("ha_refresh", "ref");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: "unauthorized" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ token: "new", refresh_token: "ref2", user: { id: "u", username: "a" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const out = await api<{ ok: boolean }>("/projects");
    expect(out.ok).toBe(true);
    expect(localStorage.getItem("ha_token")).toBe("new");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/auth/refresh");
  });

  it("clears session when refresh fails after 401", async () => {
    localStorage.setItem("ha_token", "old");
    localStorage.setItem("ha_refresh", "bad");
    const assign = vi.fn();
    vi.stubGlobal("location", { pathname: "/projects", assign });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: "unauthorized" }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: "unauthorized" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(api("/projects")).rejects.toThrow();
    expect(localStorage.getItem("ha_token")).toBeNull();
    expect(assign).toHaveBeenCalledWith("/login?reason=expired");
  });

  it("surfaces network failures without clearing session", async () => {
    localStorage.setItem("ha_token", "tok");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(api("/projects")).rejects.toMatchObject({ status: 0 });
    expect(localStorage.getItem("ha_token")).toBe("tok");
  });

  it("attaches statusCode for Refine HttpError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 409,
        statusText: "Conflict",
        text: async () => JSON.stringify({ error: "conflict" }),
      })),
    );
    try {
      await api("/projects");
      expect.unreachable();
    } catch (e) {
      expect(isApiError(e)).toBe(true);
      if (isApiError(e)) {
        expect(e.status).toBe(409);
        expect(e.statusCode).toBe(409);
        expect(e.message).toBe("conflict");
      }
    }
  });

  it("throws INSUFFICIENT_CAPACITY", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 409,
        text: async () => JSON.stringify({ error: "INSUFFICIENT_CAPACITY" }),
      })),
    );
    await expect(api("/x")).rejects.toThrow("INSUFFICIENT_CAPACITY");
  });
});

describe("friendlyError (U3)", () => {
  it("maps 403/404 for members flows", async () => {
    const { friendlyError } = await import("./providers");
    const forbidden = Object.assign(new Error("forbidden"), { status: 403 });
    const missing = Object.assign(new Error("not found"), { status: 404 });
    expect(friendlyError(forbidden)).toBe("没有权限做这件事");
    expect(friendlyError(missing)).toBe("找不到该用户或资源");
    expect(friendlyError(new Error("conflict"))).toMatch(/冲突/);
  });
});

describe("U4 capacity + apiText", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("friendlyError highlights insufficient capacity", async () => {
    const { friendlyError, isInsufficientCapacity } = await import("./providers");
    expect(isInsufficientCapacity("INSUFFICIENT_CAPACITY")).toBe(true);
    expect(isInsufficientCapacity("资源不足，请换套餐或节点（INSUFFICIENT_CAPACITY）")).toBe(true);
    const err = Object.assign(new Error("INSUFFICIENT_CAPACITY"), { status: 409 });
    expect(friendlyError(err)).toMatch(/资源不足/);
    expect(friendlyError(err)).toMatch(/INSUFFICIENT/);
  });

  it("apiText returns plain body", async () => {
    const { apiText } = await import("./providers");
    localStorage.setItem("ha_token", "tok");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => "Host ha-abc\n  RemoteCommand uuid\n",
      })),
    );
    const text = await apiText("/workspaces/w1/ssh-config");
    expect(text).toContain("Host");
    expect(text).toContain("RemoteCommand");
  });
});
