let counter = 0;

export function uniq(prefix = "e2e"): string {
  const ts = Date.now().toString(36);
  const c = (++counter).toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  const raw = `${prefix}-${ts}-${c}-${rand}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  return raw.replace(/^-+|-+$/g, "").slice(0, 60);
}

export function uniqEmail(prefix = "e2e"): string {
  return `${uniq(prefix)}@e2e.local`;
}
