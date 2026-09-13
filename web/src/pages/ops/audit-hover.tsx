import type { ReactElement, ReactNode } from "react";
import { Activity, Box, Clock, Cpu, FolderKanban, Globe, Server, User } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { popupLayerClass } from "@/lib/popup";
import { platformRoleLabel, userStatusLabel } from "@/pages/users/format";
import { formatPlanSpec, statusLabel, workspaceSpec, type Workspace } from "@/pages/workspaces/types";
import {
  actionLabel,
  auditActorLabel,
  findLastAction,
  findLastLogin,
  fmtTime,
  recentLogsForResource,
  resourceTypeLabel,
  shortId,
  uniqueResourceNames,
  type AuditEvent,
} from "@/pages/ops/format";

export type AuditHoverUser = {
  id: string;
  username: string;
  display_name?: string;
  email?: string;
  platform_role?: string;
  status?: string;
  projects?: { id: string; name: string; role: string }[];
};

export type AuditHoverProject = {
  id: string;
  name: string;
  slug?: string;
};

const cardClass =
  "max-w-[300px] bg-surface-2 text-foreground border border-border/80 shadow-surface-4 px-3 py-2.5 [text-box:initial] supports-[text-box:trim-both]:py-2.5";

function AuditHoverTip({
  testId,
  children,
  content,
}: {
  testId: string;
  children: ReactElement;
  content: ReactNode;
}) {
  return (
    <Tooltip
      side="top"
      contentClassName={popupLayerClass}
      className={cardClass}
      content={<div data-testid={testId}>{content}</div>}
    >
      {children}
    </Tooltip>
  );
}

function HoverRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: ReactNode;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 min-w-0">
      <Icon className="size-3 mt-0.5 shrink-0 opacity-60 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] leading-none text-muted-foreground">{label}</div>
        <div className="mt-0.5 text-[12px] leading-snug text-foreground break-words min-w-0">{value}</div>
      </div>
    </div>
  );
}

function joinNames(names: string[], empty = "暂无"): string {
  return names.length ? names.join("、") : empty;
}

export function ActorHoverCard({
  userId,
  displayName,
  username,
  logs,
  user,
  workspaces,
}: {
  userId: string;
  displayName?: string;
  username?: string;
  logs: AuditEvent[];
  user?: AuditHoverUser;
  workspaces: Workspace[];
}) {
  const name = auditActorLabel(user?.display_name || displayName, user?.username || username, userId);
  const lastLogin = findLastLogin(logs, userId);
  const lastAct = findLastAction(logs, userId);
  const owned = workspaces.filter((w) => w.owner_user_id === userId).map((w) => w.name).filter(Boolean);
  const touched = uniqueResourceNames(logs, userId, "workspace", (id) => workspaces.find((w) => w.id === id)?.name ?? "");
  const machines = owned.length ? owned : touched;
  const projects = (user?.projects ?? []).map((p) => p.name).filter(Boolean);

  return (
    <div className="flex flex-col gap-2 min-w-0 text-left">
      <div className="min-w-0">
        <div className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <User className="size-3.5 shrink-0 opacity-70" />
          <span className="truncate">{name}</span>
        </div>
        {username || user?.username ? (
          <div className="mt-0.5 font-mono text-[11px] text-muted-foreground truncate">
            {user?.username || username}
          </div>
        ) : null}
      </div>
      {user ? (
        <HoverRow
          icon={User}
          label="账号"
          value={[platformRoleLabel(user.platform_role), userStatusLabel(user.status)].filter((x) => x && x !== "—").join(" · ")}
        />
      ) : null}
      <HoverRow icon={Clock} label="最近登录" value={lastLogin ? fmtTime(lastLogin) : "近期日志中未见登录"} />
      <HoverRow
        icon={Activity}
        label="最近操作"
        value={
          lastAct
            ? `${actionLabel(lastAct.action)} · ${fmtTime(lastAct.created_at)}`
            : "暂无"
        }
      />
      <HoverRow
        icon={FolderKanban}
        label="加入的项目"
        value={
          projects.length
            ? joinNames(projects.slice(0, 4))
            : user
              ? "尚未加入项目"
              : undefined
        }
      />
      <HoverRow icon={Box} label="名下服务器" value={joinNames(machines.slice(0, 4), "近期未操作服务器")} />
    </div>
  );
}

export function TargetHoverCard({
  type,
  id,
  name,
  canOpen,
  logs,
  workspace,
  project,
}: {
  type: string;
  id: string;
  name: string;
  canOpen: boolean;
  logs: AuditEvent[];
  workspace?: Workspace;
  project?: AuditHoverProject;
}) {
  const recent = canOpen ? recentLogsForResource(logs, id, 3) : [];
  const spec = workspace ? workspaceSpec(workspace) : null;

  return (
    <div className="flex flex-col gap-2 min-w-0 text-left">
      <div className="min-w-0">
        <div className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <Server className="size-3.5 shrink-0 opacity-70" />
          <span className="truncate">
            {resourceTypeLabel(type)} {name}
          </span>
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground truncate">{shortId(id)}</div>
      </div>
      {!canOpen ? (
        <p className="m-0 text-[12px] text-foreground leading-snug">没有权限查看这份资源的详情。</p>
      ) : (
        <>
          {workspace ? (
            <>
              <HoverRow
                icon={Activity}
                label="当前状态"
                value={
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <HintStatus status={workspace.status} />
                    {workspace.plan || workspace.arch
                      ? ` · ${[workspace.plan, workspace.arch].filter(Boolean).join(" · ")}`
                      : null}
                  </span>
                }
              />
              {spec ? <HoverRow icon={Cpu} label="规格" value={formatPlanSpec(spec)} /> : null}
              {workspace.node_name ? <HoverRow icon={Globe} label="节点" value={workspace.node_name} /> : null}
              {project?.name ? <HoverRow icon={FolderKanban} label="所属项目" value={project.name} /> : null}
              <HoverRow
                icon={Clock}
                label="最近活动"
                value={fmtTime(workspace.last_activity_at || recent[0]?.created_at || workspace.created_at || "")}
              />
            </>
          ) : project ? (
            <HoverRow icon={FolderKanban} label="项目标识" value={project.slug || project.id} />
          ) : null}
          {recent.length ? (
            <div className="min-w-0">
              <div className="text-[10px] text-muted-foreground">最近变动</div>
              <ul className="m-0 mt-1 pl-0 list-none flex flex-col gap-1">
                {recent.map((row) => (
                  <li
                    key={`${row.created_at}-${row.action}`}
                    className="inline-flex items-center gap-1.5 min-w-0 text-[12px] text-foreground"
                  >
                    <span className="truncate">{actionLabel(row.action)}</span>
                    <span className="shrink-0 text-muted-foreground font-mono text-[11px]">{fmtTime(row.created_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <HoverRow icon={Activity} label="最近变动" value="近期日志中暂无记录" />
          )}
          <p className="m-0 text-[11px] text-muted-foreground">点击名称可打开详情</p>
        </>
      )}
    </div>
  );
}

function HintStatus({ status }: { status: string }) {
  return <span className="text-foreground">{statusLabel(status)}</span>;
}

export function AuditActorHover({
  children,
  ...props
}: {
  children: ReactElement;
} & Parameters<typeof ActorHoverCard>[0]) {
  return (
    <AuditHoverTip testId="audit-actor-hover" content={<ActorHoverCard {...props} />}>
      {children}
    </AuditHoverTip>
  );
}

export function AuditTargetHover({
  children,
  ...props
}: {
  children: ReactElement;
} & Parameters<typeof TargetHoverCard>[0]) {
  return (
    <AuditHoverTip testId="audit-target-hover" content={<TargetHoverCard {...props} />}>
      {children}
    </AuditHoverTip>
  );
}

export function actorHoverUser(users: AuditHoverUser[] | undefined, id: string): AuditHoverUser | undefined {
  return users?.find((u) => u.id === id);
}
