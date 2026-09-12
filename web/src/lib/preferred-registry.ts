export const PREFERRED_REGISTRY = {
  name: "CNB",
  server: "docker.cnb.cool",
  console: "https://cnb.cool",
  imageExample: "docker.cnb.cool/<组织>/<仓库>:<标签>",
  note: "推送镜像与部署时优先使用 CNB，不要默认 Docker Hub。",
} as const;

export function isPreferredRegistry(server?: string) {
  const s = (server ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  return s === PREFERRED_REGISTRY.server || s.endsWith(".cnb.cool");
}
