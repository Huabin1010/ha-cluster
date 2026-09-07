export type Project = {
  id: string;
  name: string;
  slug: string;
  owner_id?: string;
  status?: string;
  my_role?: string;
  budget_cpu_milli?: number;
  budget_mem_bytes?: number;
  budget_disk_bytes?: number;
  created_at?: string;
};

export type ProjectUsage = {
  project_id: string;
  workspaces: number;
  cpu_milli: number;
  mem_bytes: number;
  disk_bytes: number;
};

/** slug: 小写字母、数字、短横线（不可首尾短横线、不可连续短横线） */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && slug.length <= 64;
}

export function suggestSlugFromName(n: string): string {
  return n
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function canManageProject(
  role?: string,
  platformRole?: string,
  ownerId?: string,
  currentUserId?: string,
): boolean {
  if (platformRole === "platform_admin") return true;
  if (role === "owner") return true;
  if (ownerId && currentUserId && ownerId === currentUserId) return true;
  return false;
}
