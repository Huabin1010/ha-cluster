export const CURRENT_PROJECT_KEY = "ha_current_project";

export function readCurrentProject(): string {
  try {
    return localStorage.getItem(CURRENT_PROJECT_KEY) || "";
  } catch {
    return "";
  }
}

export function writeCurrentProject(id: string) {
  try {
    if (id) localStorage.setItem(CURRENT_PROJECT_KEY, id);
    else localStorage.removeItem(CURRENT_PROJECT_KEY);
  } catch {
    /* private mode / quota */
  }
}
