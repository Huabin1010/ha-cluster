import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CI = !!process.env.CI;
const WEB = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8088";
const goBin = path.join(process.env.HOME ?? "", ".local", "go", "bin");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: WEB,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      grepInvert: /@responsive|@capacity/,
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"] },
      grep: /@responsive/,
    },
    {
      name: "capacity-serial",
      use: { ...devices["Desktop Chrome"] },
      grep: /@capacity/,
      fullyParallel: false,
      dependencies: ["chromium"],
    },
  ],
  webServer: [
    {
      command: `${path.resolve(__dirname, "../bin/ha-api")}`,
      cwd: path.resolve(__dirname, ".."),
      url: `${API}/healthz`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        ...process.env,
        HA_RUNTIME: "memory",
        HA_API_ADDR: "127.0.0.1:8088",
        PATH: `${goBin}:${process.env.PATH}`,
      },
    },
    {
      command: "npm run dev",
      cwd: __dirname,
      url: WEB,
      reuseExistingServer: !CI,
      timeout: 60_000,
      env: {
        ...process.env,
        VITE_API_TARGET: API,
      },
    },
  ],
});
