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

  // Seed standard QA users
  await Promise.all([
    safeRegister("qa_owner", "qa_owner@mnnumath.vip"),
    safeRegister("qa_dev", "qa_dev@mnnumath.vip"),
    safeRegister("qa_viewer", "qa_viewer@mnnumath.vip"),
  ]);

  // Seed pool worker nodes for high-capacity concurrency
  await Promise.all([
    api.heartbeat({
      name: "e2e-pool-amd64",
      arch: "amd64",
      class: "desktop",
      power: "battery",
      role: "worker",
      fabric_ip: "10.88.0.201",
      fabric_path: "p2p",
      fabric_rtt_ms: 2,
      allocatable_cpu_milli: 32000,
      allocatable_mem_bytes: 32 * 1024 * 1024 * 1024,
      allocatable_disk_bytes: 500 * 1024 * 1024 * 1024,
    }),
    api.heartbeat({
      name: "e2e-pool-arm64",
      arch: "arm64",
      class: "desktop",
      power: "battery",
      role: "worker",
      fabric_ip: "10.88.0.202",
      fabric_path: "p2p",
      fabric_rtt_ms: 3,
      allocatable_cpu_milli: 16000,
      allocatable_mem_bytes: 16 * 1024 * 1024 * 1024,
      allocatable_disk_bytes: 200 * 1024 * 1024 * 1024,
    }),
  ]);
}
