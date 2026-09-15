export type Project = {
  id: string;
  name: string;
  slug: string;
  purpose?: string;
  owner_id?: string;
  status?: string;
  my_role?: string;
  my_ssh_access?: string;
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

/** 显示名：英文开头，仅字母、数字、空格、短横线、下划线、点、撇号 */
export const PROJECT_NAME_RE = /^[A-Za-z][A-Za-z0-9 ._'-]*$/;
export const PROJECT_NAME_MAX = 128;

export function normalizeProjectName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function isValidProjectName(raw: string): boolean {
  const n = normalizeProjectName(raw);
  return PROJECT_NAME_RE.test(n) && n.length <= PROJECT_NAME_MAX;
}

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

export const PURPOSE_MIN = 2;
export const PURPOSE_MAX = 80;

export function normalizePurpose(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function isValidPurpose(raw: string, name = "", slug = ""): boolean {
  const p = normalizePurpose(raw);
  const n = Array.from(p).length;
  if (n < PURPOSE_MIN || n > PURPOSE_MAX) return false;
  const nName = name.trim();
  const nSlug = slug.trim().toLowerCase();
  if (nName && p.toLowerCase() === nName.toLowerCase()) return false;
  if (nSlug && p.toLowerCase() === nSlug) return false;
  return true;
}

export function purposeMissing(purpose?: string): boolean {
  return !isValidPurpose(purpose ?? "");
}
