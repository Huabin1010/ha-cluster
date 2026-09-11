const API_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:8088";

export class ApiRequestError extends Error {
  status: number;
  body: string;
  constructor(status: number, message: string, body = "") {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.body = body;
  }
}

async function request<T = unknown>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<{ status: number; data: T }> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const url = `${API_URL}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    let msg = res.statusText;
    if (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string") {
      msg = (data as { error: string }).error;
    } else if (typeof data === "string") {
      msg = data;
    }
    throw new ApiRequestError(res.status, msg, text);
  }
  return { status: res.status, data: data as T };
}

export type AuthTokens = {
  token: string;
  refresh_token: string;
  user: { id: string; username: string; platform_role?: string };
};

export const api = {
  async register(username: string, email: string, password = "password1") {
    return request("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, email, password }),
    });
  },

  async login(username: string, password = "password1"): Promise<AuthTokens> {
    const res = await request<AuthTokens>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    return res.data;
  },

  async logout(refreshToken: string) {
    return request("/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  },

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const res = await request<AuthTokens>("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    return res.data;
  },

  async me(token: string) {
    return request("/me", { method: "GET" }, token);
  },

  async createProject(token: string, data: { name: string; slug: string }) {
    const res = await request<{ id: string; name: string; slug: string }>("/projects", {
      method: "POST",
      body: JSON.stringify(data),
    }, token);
    return res.data;
  },

  async listProjects(token: string) {
    const res = await request<{ data: Array<{ id: string; name: string; slug: string }> }>("/projects", {
      method: "GET",
    }, token);
    return res.data;
  },

  async getProject(token: string, id: string) {
    const res = await request<{ id: string; name: string; slug: string }>("/projects/" + id, {
      method: "GET",
    }, token);
    return res.data;
  },

  async patchBudget(
    token: string,
    id: string,
    budget: { budget_cpu_milli?: number; budget_mem_bytes?: number; budget_disk_bytes?: number },
  ) {
    const res = await request("/projects/" + id, {
      method: "PATCH",
      body: JSON.stringify(budget),
    }, token);
    return res.data;
  },

  async patchProject(
    token: string,
    id: string,
    data: { name?: string; slug?: string; budget_cpu_milli?: number; budget_mem_bytes?: number; budget_disk_bytes?: number },
  ) {
    const res = await request("/projects/" + id, {
      method: "PATCH",
      body: JSON.stringify(data),
    }, token);
    return res.data;
  },

  async deleteProject(token: string, id: string) {
    return request("/projects/" + id, { method: "DELETE" }, token);
  },

  async usage(token: string, id: string) {
    const res = await request<{
      project_id: string;
      workspaces: number;
      cpu_milli: number;
      mem_bytes: number;
      disk_bytes: number;
    }>("/projects/" + id + "/usage", { method: "GET" }, token);
    return res.data;
  },

  async addMember(token: string, projectId: string, member: { username: string; role: string }) {
    const res = await request("/projects/" + projectId + "/members", {
      method: "POST",
      body: JSON.stringify(member),
    }, token);
    return res.data;
  },

  async listMembers(token: string, projectId: string) {
    const res = await request<{ data: Array<{ project_id: string; user_id: string; role: string }> }>(
      "/projects/" + projectId + "/members",
      { method: "GET" },
      token,
    );
    return res.data;
  },

  async removeMember(token: string, projectId: string, userId: string) {
    return request("/projects/" + projectId + "/members/" + userId, {
      method: "DELETE",
    }, token);
  },

  async createInvitation(token: string, projectId: string, inv: { email: string; role: string }) {
    const res = await request<{ token: string }>("/projects/" + projectId + "/invitations", {
      method: "POST",
      body: JSON.stringify(inv),
    }, token);
    return res.data;
  },

  async acceptInvite(token: string, inviteToken: string) {
    const res = await request<{ status: string; project_id?: string }>("/invitations/accept", {
      method: "POST",
      body: JSON.stringify({ token: inviteToken }),
    }, token);
    return res.data;
  },

  async createWorkspace(
    token: string,
    projectId: string,
    ws: { name?: string; plan: string; arch?: string; visibility?: string },
  ) {
    const res = await request<{ id: string; name: string; plan: string; arch: string; status: string }>(
      "/projects/" + projectId + "/workspaces",
      {
        method: "POST",
        body: JSON.stringify(ws),
      },
      token,
    );
    return res.data;
  },

  async listWorkspaces(token: string, projectId?: string) {
    const q = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
    const res = await request<{ data: Array<{ id: string; name: string; plan: string; status: string }> }>(
      "/workspaces" + q,
      { method: "GET" },
      token,
    );
    return res.data;
  },

  async approveWorkspace(token: string, id: string) {
    return request("/workspaces/" + id + "/approve", { method: "POST", body: "{}" }, token);
  },

  async rejectWorkspace(token: string, id: string, reason = "") {
    return request("/workspaces/" + id + "/reject", {
      method: "POST",
      body: JSON.stringify({ reason }),
    }, token);
  },

  async getConnection(token: string, id: string) {
    const res = await request<{ command: string; host: string; port: number }>("/workspaces/" + id + "/connection", {
      method: "GET",
    }, token);
    return res.data;
  },

  async startWorkspace(token: string, id: string) {
    return request("/workspaces/" + id + "/start", { method: "POST" }, token);
  },

  async stopWorkspace(token: string, id: string) {
    return request("/workspaces/" + id + "/stop", { method: "POST" }, token);
  },

  async requestDestroyWorkspace(token: string, id: string) {
    return request("/workspaces/" + id + "/destroy-request", { method: "POST", body: "{}" }, token);
  },

  async approveDestroyProject(token: string, id: string) {
    return request("/workspaces/" + id + "/destroy-request/approve", { method: "POST", body: "{}" }, token);
  },

  async approveDestroyPlatform(token: string, id: string) {
    return request("/admin/dangerous-approvals/" + id + "/approve", { method: "POST", body: "{}" }, token);
  },

  /** Full destroy approval chain (project owner + platform admin tokens). */
  async destroyWorkspace(ownerToken: string, id: string, platformAdminToken?: string) {
    await request("/workspaces/" + id + "/destroy-request", { method: "POST", body: "{}" }, ownerToken);
    await request("/workspaces/" + id + "/destroy-request/approve", { method: "POST", body: "{}" }, ownerToken).catch(() => undefined);
    let adminTok = platformAdminToken;
    if (!adminTok) {
      const creds = await request<AuthTokens>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "admin", password: process.env.HA_ADMIN_PASSWORD ?? "123456qq" }),
      });
      adminTok = (creds.data as AuthTokens).token;
    }
    await request("/admin/dangerous-approvals/" + id + "/approve", { method: "POST", body: "{}" }, adminTok);
  },

  async getSSHConfig(token: string, id: string) {
    const res = await request<string>("/workspaces/" + id + "/ssh-config", { method: "GET" }, token);
    return res.data;
  },

  async heartbeat(node: {
    name: string;
    arch: string;
    class?: string;
    power?: string;
    role?: string;
    fabric_ip?: string;
    lan_ip?: string;
    breakglass_ssh?: string;
    allocatable_cpu_milli?: number;
    allocatable_mem_bytes?: number;
    allocatable_disk_bytes?: number;
    used_cpu_milli?: number;
    used_mem_bytes?: number;
    used_disk_bytes?: number;
    mem_total_bytes?: number;
    disk_total_bytes?: number;
    mem_available_bytes?: number;
    disk_free_bytes?: number;
    fabric_path?: string;
    fabric_rtt_ms?: number;
    ready?: boolean;
  }) {
    const res = await request<{ id: string; name: string; ready: boolean }>("/nodes/heartbeat", {
      method: "POST",
      body: JSON.stringify(node),
    });
    return res.data;
  },

  async listNodes(token: string) {
    const res = await request<{ data: Array<{ id: string; name: string; ready: boolean; fabric_ip: string }> }>(
      "/nodes",
      { method: "GET" },
      token,
    );
    return res.data;
  },

  async capacity(token: string) {
    const res = await request<{
      nodes: Array<unknown>;
      pools: Array<{ arch: string; cpu_milli_free: number; mem_bytes_free: number; disk_bytes_free: number }>;
    }>("/capacity", { method: "GET" }, token);
    return res.data;
  },

  async listSSHKeys(token: string) {
    const res = await request<{ data: Array<{ id: string; name: string; fingerprint: string }> }>(
      "/me/ssh-keys",
      { method: "GET" },
      token,
    );
    return res.data;
  },

  async addSSHKey(token: string, key: { name: string; public_key: string }) {
    const res = await request<{ id: string; name: string; fingerprint: string }>("/me/ssh-keys", {
      method: "POST",
      body: JSON.stringify(key),
    }, token);
    return res.data;
  },

  async deleteSSHKey(token: string, id: string) {
    return request("/me/ssh-keys/" + id, { method: "DELETE" }, token);
  },

  async reconcile(adminToken: string) {
    const res = await request<{ released: number; stale_nodes: number }>("/admin/reconcile", {
      method: "POST",
    }, adminToken);
    return res.data;
  },
};
