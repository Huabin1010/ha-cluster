import { api, ApiRequestError } from "./helpers/api";

const API_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:8088";
const WEB_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";

async function waitUrl(url: string, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404 || res.status === 200) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function safeRegister(username: string, email: string) {
  try {
    await api.register(username, email, "password1");
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 409) {
      // already exists
      return;
    }
    throw e;
  }
}

export default async function globalSetup() {
  await Promise.all([
    waitUrl(`${API_URL}/healthz`, 90_000),
    waitUrl(WEB_URL, 60_000),
  ]);

  const adminPassword = process.env.HA_ADMIN_PASSWORD ?? "123456qq";
  try {
    await api.login("admin", adminPassword);
  } catch {
    await api.register("admin", "admin@mnnumath.vip", adminPassword);
  }

  await Promise.all([
    safeRegister("qa_owner", "qa_owner@mnnumath.vip"),
    safeRegister("qa_dev", "qa_dev@mnnumath.vip"),
    safeRegister("qa_viewer", "qa_viewer@mnnumath.vip"),
  ]);

}
