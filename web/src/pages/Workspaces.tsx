import { useCallback, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useGetIdentity, useList } from "@refinedev/core";
import { isInsufficientCapacity, type AuthUser } from "../providers";
import { Banner, Empty, Loading, PageHeader, useToast } from "../ui";
import { CreateForm } from "./workspaces/CreateForm";
import { WorkspaceRow } from "./workspaces/WorkspaceRow";
import { canApproveRole, ProjectOption, Workspace } from "./workspaces/types";
import { Button } from "../components/ui/button";
import { SelectBox } from "../components/ui/select";
import { Field } from "../components/ui/field";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { PageFrame } from "../components/ui/page-frame";
import { Paginator } from "../components/ui/pagination";
import { useClientPager } from "../lib/use-client-pager";
import { writeCurrentProject } from "../lib/current-project";

export function WorkspacesPage() {
  const toast = useToast();
  const { data: me } = useGetIdentity<AuthUser>();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectFilter = searchParams.get("project_id") || "";

  const [err, setErr] = useState("");
  const [insufficient, setInsufficient] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const reloadUsageRef = useRef<(() => void) | undefined>(undefined);

  const showError = useCallback((msg: string, isInsufficient = false) => {
    setErr(msg);
    setInsufficient(!!msg && (isInsufficient || isInsufficientCapacity(msg)));
  }, []);

  const { data: projectData } = useList<ProjectOption>({
    resource: "projects",
    pagination: { mode: "off" },
  });
  const { data, isLoading, refetch } = useList<Workspace>({
    resource: "workspaces",
    pagination: { mode: "off" },
    filters: projectFilter ? [{ field: "project_id", operator: "eq", value: projectFilter }] : [],
    errorNotification: false,
  });

  const projects = projectData?.data ?? [];
  const selected = projects.find((p) => p.id === projectFilter);
  const canApprove = canApproveRole(selected?.my_role, me?.platform_role);
  const rows = (data?.data ?? []).filter((w) => w.status !== "destroyed");
  const pending = rows.filter((w) => w.status === "requested").length;
  const pendingResize = rows.filter((w) => w.resize_status === "pending").length;
  const pager = useClientPager(rows, projectFilter);

  function setProjectFilter(id: string) {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("project_id", id);
    else next.delete("project_id");
    writeCurrentProject(id);
    setSearchParams(next, { replace: true });
  }

  function afterMutation() {
    reloadUsageRef.current?.();
    void refetch();
  }

  return (
    <PageFrame
      header={
        <div className="grid gap-3">
          <PageHeader
            title="服务器"
            description="按项目申请隔离机器（例如 2 核 / 2GiB / 5GiB 盘）。开通后可再提交扩容，均需管理员批准；不提供硬盘缩容。"
            actions={
              <CreateForm
                projects={projects}
                initialProjectId={projectFilter}
                reloadUsageRef={reloadUsageRef}
                canApprove={canApprove}
                platformRole={me?.platform_role}
                onCreated={() => {
                  showError("");
                  toast.show(canApprove ? "创建成功" : "已提交申请，等待管理员审批", "success");
                  afterMutation();
                }}
                onError={showError}
              />
            }
          />
          {pending > 0 && canApprove && (
            <Banner kind="info">
              <span data-testid="ws-pending-banner">有 {pending} 条服务器申请待审批</span>
            </Banner>
          )}
          {pendingResize > 0 && canApprove && (
            <Banner kind="info">
              <span data-testid="ws-resize-banner">有 {pendingResize} 条扩容申请待审批</span>
            </Banner>
          )}
          {err && (
            <Banner
              kind="error"
              className={insufficient ? "ws-insufficient border-destructive" : undefined}
              onClose={() => showError("")}
            >
              <span data-testid="ws-error">{err}</span>
            </Banner>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <Field label="按项目筛选" className="min-w-52">
              <SelectBox
                testId="ws-filter-project"
                value={projectFilter || "__all__"}
                onValueChange={(v) => setProjectFilter(v === "__all__" ? "" : v)}
                placeholder="全部项目"
                options={[
                  { value: "__all__", label: "全部项目" },
                  ...projects.map((p) => ({ value: p.id, label: `${p.name} (${p.slug})` })),
                ]}
              />
            </Field>
            <Button type="button" variant="outline" onClick={() => void refetch()}>
              刷新
            </Button>
          </div>
        </div>
      }
      footer={
        <Paginator
          page={pager.page}
          pageCount={pager.pageCount}
          pageSize={pager.pageSize}
          total={pager.total}
          onPageChange={pager.setPage}
          onPageSizeChange={pager.setPageSize}
        />
      }
    >
      {isLoading ? (
        <Loading label="加载服务器…" />
      ) : rows.length === 0 ? (
        <Empty
          title={projectFilter ? "该项目还没有服务器" : "还没有服务器"}
          description="在项目里申请隔离环境；普通成员需管理员批准后才能连接。"
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>套餐</TableHead>
              <TableHead>arch</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>可见性</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pager.slice.map((w) => (
              <WorkspaceRow
                key={w.id}
                ws={w}
                busyId={busyId}
                canApprove={canApprove}
                onBusy={setBusyId}
                onRefresh={afterMutation}
                onToast={(msg) => toast.show(msg, "info")}
                onError={(msg) => showError(msg)}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </PageFrame>
  );
}
