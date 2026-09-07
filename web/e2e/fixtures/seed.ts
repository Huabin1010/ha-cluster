import { api } from "../helpers/api";
import { uniq } from "../helpers/ids";

export async function seedProject(ownerToken: string, prefix = "proj") {
  const slug = uniq(prefix);
  const name = `E2E ${slug}`;
  const p = await api.createProject(ownerToken, { name, slug });
  return p;
}

export async function seedProjectWithMembers(ownerToken: string, prefix = "proj-rb") {
  const p = await seedProject(ownerToken, prefix);
  await api.addMember(ownerToken, p.id, { username: "qa_dev", role: "developer" });
  await api.addMember(ownerToken, p.id, { username: "qa_viewer", role: "viewer" });
  return p;
}

export async function seedWorkspace(
  token: string,
  projectId: string,
  options: { name?: string; plan?: string; arch?: string; visibility?: string } = {},
) {
  const plan = options.plan ?? "nano";
  const arch = options.arch ?? "amd64";
  const name = options.name ?? uniq("ws");
  const visibility = options.visibility ?? "shared";
  return api.createWorkspace(token, projectId, { name, plan, arch, visibility });
}

export async function destroyWorkspaces(token: string, wsIds: string[]) {
  for (const id of wsIds) {
    try {
      await api.destroyWorkspace(token, id);
    } catch {
      // ignore
    }
  }
}

/**
 * Fills up an architecture's capacity in a project until 409 is reached.
 * Returns the list of created workspace IDs to clean up later.
 */
export async function fillArch(token: string, projectId: string, arch: "amd64" | "arm64") {
  const createdIds: string[] = [];
  const plans = ["xlarge", "large", "medium", "small", "nano"];

  for (let round = 0; round < 25; round++) {
    let succeededInRound = false;
    for (const plan of plans) {
      try {
        const ws = await api.createWorkspace(token, projectId, {
          name: uniq(`fill-${arch}`),
          plan,
          arch,
        });
        createdIds.push(ws.id);
        succeededInRound = true;
      } catch (e: unknown) {
        // failed on this plan, try smaller
      }
    }
    if (!succeededInRound) break;
  }
  return createdIds;
}
