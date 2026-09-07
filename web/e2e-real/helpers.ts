import { exec, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import util from "node:util";

const execAsync = util.promisify(exec);

export async function runCmd(cmd: string): Promise<{ stdout: string; stderr: string }> {
  return execAsync(cmd, { shell: "/bin/bash" });
}

export function generateSSHKeyPair(name = "real_e2e_key"): { privateKeyPath: string; publicKey: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ha-e2e-"));
  const privPath = path.join(tmpDir, name);
  const pubPath = `${privPath}.pub`;

  const res = spawnSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", privPath]);
  if (res.status !== 0) {
    throw new Error(`ssh-keygen failed: ${res.stderr?.toString()}`);
  }

  const publicKey = fs.readFileSync(pubPath, "utf-8").trim();
  fs.chmodSync(privPath, 0o600);
  return { privateKeyPath: privPath, publicKey };
}

export async function getIncusContainerInfo(shortId: string): Promise<{ name: string; state: string; ip: string } | null> {
  const containerName = `ha-${shortId}`;
  try {
    const { stdout: stateOut } = await runCmd(`incus list ${containerName} -c s -f csv`);
    const state = stateOut.trim();
    if (!state) return null;
    let ip = "";
    try {
      const { stdout: ipOut } = await runCmd(`incus list ${containerName} -c 4 -f csv`);
      ip = ipOut.trim().split(" ")[0].trim();
    } catch {
      ip = "";
    }
    return { name: containerName, state, ip };
  } catch {
    return null;
  }
}
