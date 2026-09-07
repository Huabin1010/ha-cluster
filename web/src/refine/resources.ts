import type { ResourceProps } from "@refinedev/core";

/** Sidebar + CRUD resource map — ADR-010 §9.2 */
export const resources: ResourceProps[] = [
  { name: "projects", list: "/projects", show: "/projects/:id", meta: { label: "项目", testId: "nav-projects" } },
  { name: "memberships", list: "/members", meta: { label: "成员", testId: "nav-members" } },
  { name: "workspaces", list: "/workspaces", show: "/workspaces/:id", meta: { label: "服务器", testId: "nav-workspaces" } },
  { name: "nodes", list: "/nodes", meta: { label: "节点", testId: "nav-nodes" } },
  { name: "capacity", list: "/capacity", meta: { label: "容量", testId: "nav-capacity" } },
  { name: "ssh-keys", list: "/settings/keys", meta: { label: "SSH 公钥", testId: "nav-keys" } },
  { name: "audit-logs", list: "/audit", meta: { label: "审计", testId: "nav-audit" } },
];
