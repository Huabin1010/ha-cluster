/**
 * Cross-platform local dev launcher (Windows / macOS / Linux).
 *
 *   bun scripts/dev.ts          # api + web
 *   bun scripts/dev.ts --api    # Go hot reload only
 *   bun scripts/dev.ts --web    # Vite only
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

type Subprocess = ReturnType<typeof Bun.spawn>;

const isWindows = process.platform === "win32";
const root = join(import.meta.dir, "..");
const args = new Set(process.argv.slice(2));

function log(msg: string) {
  console.log(`>>> ${msg}`);
}

function fail(msg: string): never {
  console.error(`>>> ${msg}`);
  process.exit(1);
}

function goEnv(name: string): string {
  const result = Bun.spawnSync(["go", "env", name], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    fail("未检测到 Go，请先安装 Go 1.24+ 并确保 go 在 PATH 中。");
  }
  return result.stdout.toString().trim();
}

function goBinDir(): string {
  const gobin = goEnv("GOBIN");
  if (gobin) return gobin;
  const gopath = goEnv("GOPATH");
  const first = gopath.split(delimiter).filter(Boolean)[0];
  if (first) return join(first, "bin");
  return join(homedir(), "go", "bin");
}

function prependPath(dir: string) {
  const current = process.env.PATH ?? process.env.Path ?? "";
  if (current.split(delimiter).includes(dir)) return;
  process.env.PATH = `${dir}${delimiter}${current}`;
}

function resolveOnPath(cmd: string): string | null {
  const names = isWindows && !/\.[A-Za-z0-9]+$/.test(cmd) ? [cmd, `${cmd}.exe`, `${cmd}.cmd`, `${cmd}.bat`] : [cmd];
  for (const name of names) {
    const result = Bun.spawnSync([isWindows ? "where.exe" : "which", name], {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    if (result.exitCode !== 0) continue;
    const hit = result.stdout.toString().split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (hit && existsSync(hit)) return hit;
  }
  return null;
}

function ensureAir(): string {
  prependPath(goBinDir());
  prependPath(join(homedir(), ".local", "go", "bin"));

  let air = resolveOnPath("air");
  if (!air) {
    log("未检测到 air，正在自动安装...");
    const install = Bun.spawnSync(["go", "install", "github.com/air-verse/air@latest"], {
      cwd: root,
      stdout: "inherit",
      stderr: "inherit",
      env: process.env,
    });
    if (install.exitCode !== 0) {
      fail("安装 air 失败，请检查 Go 环境后重试。");
    }
    air = resolveOnPath("air");
  }
  if (!air) fail("安装 air 后仍未找到可执行文件，请将 GOPATH/bin 加入 PATH。");
  return air;
}

function parsePort(): number {
  const addr = process.env.HA_API_ADDR || ":8080";
  const port = Number(addr.split(":").pop());
  return Number.isFinite(port) && port > 0 ? port : 8080;
}

function processName(pid: number): string {
  if (isWindows) {
    const result = Bun.spawnSync(["tasklist", "/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return result.stdout.toString();
  }
  const result = Bun.spawnSync(["ps", "-p", String(pid), "-o", "comm="], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return result.stdout.toString();
}

function findListenerPid(port: number): number | null {
  if (isWindows) {
    const result = Bun.spawnSync(["netstat", "-ano"], { stdout: "pipe", stderr: "pipe" });
    const re = new RegExp(`[:\\[]${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, "i");
    for (const line of result.stdout.toString().split(/\r?\n/)) {
      const match = line.match(re);
      if (match) return Number(match[1]);
    }
    return null;
  }

  const lsof = Bun.spawnSync(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (lsof.exitCode === 0) {
    const pid = Number(lsof.stdout.toString().trim().split(/\s+/)[0]);
    if (pid) return pid;
  }

  const ss = Bun.spawnSync(["ss", "-tulpn"], { stdout: "pipe", stderr: "pipe" });
  if (ss.exitCode === 0) {
    for (const line of ss.stdout.toString().split(/\n/)) {
      if (!line.includes(`:${port} `) && !line.includes(`:${port}\n`)) continue;
      const match = line.match(/pid=(\d+)/);
      if (match) return Number(match[1]);
    }
  }
  return null;
}

function maybeFreePort(port: number) {
  const pid = findListenerPid(port);
  if (!pid) return;

  const cmd = processName(pid);
  if (/ha-api|air/i.test(cmd)) {
    log(`端口 ${port} 被旧后台进程 (PID: ${pid}) 占用，正在自动释放...`);
    if (isWindows) {
      Bun.spawnSync(["taskkill", "/PID", String(pid), "/T", "/F"], { stdout: "pipe", stderr: "pipe" });
    } else {
      Bun.spawnSync(["kill", "-9", String(pid)], { stdout: "pipe", stderr: "pipe" });
    }
    Bun.sleepSync(500);
    return;
  }

  log(`注意：端口 ${port} 当前已被占用 (PID: ${pid})。`);
  log("如果是旧版后台 ha-api 进程，可结束该进程后重试，或换端口启动：");
  log(isWindows ? "    $env:HA_API_ADDR=':8088'; bun run dev:api" : "    HA_API_ADDR=:8088 bun run dev:api");
}

function killTree(proc: Subprocess) {
  if (proc.exitCode !== null) return;
  if (isWindows && proc.pid) {
    Bun.spawnSync(["taskkill", "/PID", String(proc.pid), "/T", "/F"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return;
  }
  proc.kill("SIGTERM");
}

function spawnInherit(cmd: string, cmdArgs: string[]): Subprocess {
  return Bun.spawn([cmd, ...cmdArgs], {
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });
}

async function main() {
  const apiOnly = args.has("--api");
  const webOnly = args.has("--web");
  const runApi = !webOnly;
  const runWeb = !apiOnly;
  const children: Subprocess[] = [];

  if (runWeb) {
    const webPkg = join(root, "web", "package.json");
    if (!existsSync(webPkg)) fail("未找到 web/package.json。");
    if (!existsSync(join(root, "node_modules")) && !existsSync(join(root, "web", "node_modules"))) {
      fail("未安装前端依赖，请先在仓库根目录执行：bun install");
    }
  }

  if (runApi) {
    const air = ensureAir();
    maybeFreePort(parsePort());
    const config = isWindows ? ".air.windows.toml" : ".air.toml";
    log("启动 Go 热重载开发服务 (air)...");
    children.push(spawnInherit(air, ["-c", config]));
  }

  if (runWeb) {
    log("启动前端开发服务 (vite)...");
    children.push(spawnInherit(process.execPath, ["--filter", "ha-web", "dev"]));
  }

  const shutdown = () => {
    for (const child of children) killTree(child);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const codes = await Promise.all(
    children.map(async (child) => {
      const code = await child.exited;
      for (const other of children) {
        if (other !== child) killTree(other);
      }
      return code ?? 1;
    }),
  );

  process.exit(codes.find((code) => code !== 0) ?? 0);
}

await main();
