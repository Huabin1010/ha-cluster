import { MouseEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCreate, useDelete, useGetIdentity, useList, useUpdate } from "@refinedev/core";
import { Plus } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Button } from "../components/ui/button";
import { Alert, AlertDescription } from "../components/ui/alert";
import { PageFrame } from "../components/ui/page-frame";
import { Paginator } from "../components/ui/pagination";
import { Empty, PageBody, PageHeader } from "../ui";
import { friendlyError, type AuthUser } from "../providers";
import { copyText, formatTime } from "./projects/format";
import { canManageProject, type Project } from "./projects/types";
import { ProjectFormDialog } from "./projects/FormDialog";
import { ProjectDeleteDialog } from "./projects/DeleteDialog";
import { useClientPager } from "../lib/use-client-pager";
import { readCurrentProject, writeCurrentProject } from "../lib/current-project";

function slugConflictMessage(e: unknown): string | null {
  const raw = e instanceof Error ? e.message : String(e);
  if (raw === "conflict" || raw.includes("conflict")) {
    return "slug 已被占用，请换一个";
  }
  return null;
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const { data: me } = useGetIdentity<AuthUser>();
  const { data, isLoading, refetch } = useList<Project>({ resource: "projects", pagination: { mode: "off" } });
  const { mutate: create, isLoading: creating } = useCreate();
  const { mutate: patch, isLoading: saving } = useUpdate();
  const { mutate: remove } = useDelete();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Project | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Project | null>(null);
  const [formErr, setFormErr] = useState("");
  const [listErr, setListErr] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const rows = data?.data ?? [];
  const pager = useClientPager(rows);

  async function onCopyId(e: MouseEvent, id: string) {
    e.stopPropagation();
    const ok = await copyText(id);
    if (ok) {
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    }
  }

  function onCreate(name: string, slug: string) {
    setFormErr("");
    create(
      { resource: "projects", values: { name, slug } },
      {
        onSuccess: (res) => {
          setCreateOpen(false);
          void refetch();
          const id = (res?.data as Project | undefined)?.id;
          if (id) {
            writeCurrentProject(id);
            navigate(`/projects/${id}`);
          }
        },
        onError: (e) => setFormErr(slugConflictMessage(e) || friendlyError(e)),
      },
    );
  }

  function onSave(name: string, slug: string) {
    if (!editTarget) return;
    setFormErr("");
    patch(
      {
        resource: "projects",
        id: editTarget.id,
        values: { name, slug },
        successNotification: { message: "项目已保存", type: "success" },
        errorNotification: false,
      },
      {
        onSuccess: () => {
          setEditTarget(null);
          void refetch();
        },
        onError: (e) => setFormErr(slugConflictMessage(e) || friendlyError(e)),
      },
    );
  }

  function confirmRemove() {
    if (!removeTarget) return;
    const target = removeTarget;
    setRemoveTarget(null);
    setListErr("");
    remove(
      {
        resource: "projects",
        id: target.id,
        successNotification: { message: "项目已删除", type: "success" },
        errorNotification: false,
      },
      {
        onSuccess: () => {
          if (readCurrentProject() === target.id) writeCurrentProject("");
          void refetch();
        },
        onError: (e) => setListErr(friendlyError(e)),
      },
    );
  }

  function openProject(p: Project) {
    writeCurrentProject(p.id);
    navigate(`/projects/${p.id}`);
  }

  return (
    <>
      <PageFrame
        header={
          <PageHeader
            title="项目"
            description="登录后先选项目。进入后可申请隔离服务器，管理员批准后获得 SSH 连接。"
            actions={
              <Button type="button" data-testid="project-create-open" onClick={() => { setFormErr(""); setCreateOpen(true); }}>
                <Plus className="h-4 w-4" />
                创建项目
              </Button>
            }
          />
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
        <PageBody loading={isLoading}>
          {listErr && (
            <Alert variant="destructive" className="mb-3" data-testid="project-list-error">
              <AlertDescription>{listErr}</AlertDescription>
            </Alert>
          )}
          {rows.length === 0 ? (
            <Empty text="还没有项目，创建一个" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>slug</TableHead>
                  <TableHead>id</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pager.slice.map((p) => {
                  const manage = canManageProject(p.my_role, me?.platform_role, p.owner_id, me?.id);
                  return (
                    <TableRow
                      key={p.id}
                      className="cursor-pointer"
                      data-testid="project-row"
                      onClick={() => openProject(p)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openProject(p);
                        }
                      }}
                      tabIndex={0}
                      role="link"
                    >
                      <TableCell>{p.name}</TableCell>
                      <TableCell>{p.slug}</TableCell>
                      <TableCell>
                        <span className="mono font-mono text-xs">{p.id}</span>{" "}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-testid="project-copy-id"
                          onClick={(e) => void onCopyId(e, p.id)}
                          aria-label="复制项目 id"
                        >
                          {copiedId === p.id ? "已复制" : "复制"}
                        </Button>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatTime(p.created_at)}</TableCell>
                      <TableCell
                        className="text-right"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            data-testid="project-detail"
                            onClick={() => openProject(p)}
                          >
                            详情
                          </Button>
                          {manage && (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                data-testid="project-edit"
                                onClick={() => {
                                  setFormErr("");
                                  setEditTarget(p);
                                }}
                              >
                                编辑
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                data-testid="project-delete"
                                onClick={() => setRemoveTarget(p)}
                              >
                                删除
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </PageBody>
      </PageFrame>
      <ProjectFormDialog
        open={createOpen}
        onOpenChange={(v) => {
          setCreateOpen(v);
          if (!v) setFormErr("");
        }}
        mode="create"
        submitting={creating}
        error={createOpen ? formErr : ""}
        onSubmit={onCreate}
      />
      <ProjectFormDialog
        open={!!editTarget}
        onOpenChange={(v) => {
          if (!v) {
            setEditTarget(null);
            setFormErr("");
          }
        }}
        mode="edit"
        initial={editTarget ? { name: editTarget.name, slug: editTarget.slug } : undefined}
        submitting={saving}
        error={editTarget ? formErr : ""}
        onSubmit={onSave}
      />
      <ProjectDeleteDialog
        open={!!removeTarget}
        name={removeTarget?.name}
        onOpenChange={(v) => !v && setRemoveTarget(null)}
        onConfirm={confirmRemove}
      />
    </>
  );
}
