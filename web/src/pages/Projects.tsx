import { MouseEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCreate, useDelete, useGetIdentity, useList, useUpdate } from "@refinedev/core";
import { Check, Clock, Copy, ExternalLink, FolderKanban, Hash, Pencil, Plus, RefreshCw, Search, SlidersHorizontal, Tag, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageFrame } from "@/components/ui/page-frame";
import { PageHeading } from "@/components/ui/page-heading";
import { Paginator } from "@/components/ui/pagination";
import { ListCard, ListCardActions, ListCardHeader, ListCardMeta, ResponsiveList } from "@/components/ui/responsive-list";
import { Hint } from "@/components/ui/tooltip";
import { Elevated } from "@/lib/elevated";
import { Empty, PageBody } from "@/ui";
import { friendlyError, type AuthUser } from "@/providers";
import { copyText, formatTime } from "@/pages/projects/format";
import { canManageProject, type Project } from "@/pages/projects/types";
import { ProjectFormDialog } from "@/pages/projects/FormDialog";
import { ProjectDeleteDialog } from "@/pages/projects/DeleteDialog";
import { useClientPager } from "@/lib/use-client-pager";
import { readCurrentProject, writeCurrentProject } from "@/lib/current-project";
import { cn } from "@/lib/utils";

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
  const [search, setSearch] = useState("");

  const rows = data?.data ?? [];

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.slug.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const pager = useClientPager(filteredRows);

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
          <PageHeading
            icon={FolderKanban}
            title="项目"
            badges={
              <Badge variant="outline" className="inline-flex items-center whitespace-nowrap shrink-0 px-2 py-0.5 text-xs font-mono font-normal">
                {rows.length} 个环境
              </Badge>
            }
            description="协作与资源边界。登录后先选项目，项目内可申请隔离服务器，管理员批准后获得 SSH 连接。"
            actions={
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="compact"
                  onClick={() => void refetch()}
                  aria-label="刷新列表"
                  className="h-9 px-3.5 text-muted-foreground hover:text-foreground font-normal shrink-0"
                >
                  <RefreshCw className={cn("size-3.5 mr-1.5 shrink-0", isLoading && "animate-spin")} />
                  刷新
                </Button>
                <Button
                  type="button"
                  data-testid="project-create-open"
                  onClick={() => {
                    setFormErr("");
                    setCreateOpen(true);
                  }}
                  className="h-9 px-4 font-medium shrink-0"
                >
                  <Plus className="size-4 mr-1.5 shrink-0" />
                  创建项目
                </Button>
              </>
            }
          >
            {rows.length > 0 && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div className="relative w-full sm:max-w-sm">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="搜索项目名称、slug 或 ID…"
                    className="h-8 pl-8 text-xs bg-surface-1/70 border-border/80 focus:bg-surface-1"
                  />
                </div>
                {search && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    找到 {filteredRows.length} 个匹配项
                  </span>
                )}
              </div>
            )}
          </PageHeading>
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
          ) : filteredRows.length === 0 ? (
            <Empty text="未找到匹配的项目" description="试试更换搜索关键词" />
          ) : (
            <ResponsiveList
              table={
            <Elevated
              offset={1}
              shadowLevel={2}
              className="rounded-2xl border border-border/80 bg-surface-1 shadow-surface-2 overflow-hidden flex flex-col"
            >
              <div className="w-full overflow-x-auto">
                <Table className="min-w-[860px]">
                  <TableHeader className="bg-surface-2/60 border-b border-border/70 select-none">
                    <TableRow className="border-b border-border/60 hover:bg-transparent">
                      <TableHead className="font-semibold text-xs tracking-wider text-muted-foreground uppercase py-2.5">
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <FolderKanban className="size-3.5 opacity-60 shrink-0" />
                          名称
                        </span>
                      </TableHead>
                      <TableHead className="w-[180px] font-semibold text-xs tracking-wider text-muted-foreground uppercase py-2.5">
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <Tag className="size-3.5 opacity-60 shrink-0" />
                          slug
                        </span>
                      </TableHead>
                      <TableHead className="w-[220px] font-semibold text-xs tracking-wider text-muted-foreground uppercase py-2.5">
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <Hash className="size-3.5 opacity-60 shrink-0" />
                          ID
                        </span>
                      </TableHead>
                      <TableHead className="w-[160px] font-semibold text-xs tracking-wider text-muted-foreground uppercase py-2.5">
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <Clock className="size-3.5 opacity-60 shrink-0" />
                          创建时间
                        </span>
                      </TableHead>
                      <TableHead stickyEnd className="w-[200px] text-right font-semibold text-xs tracking-wider text-muted-foreground uppercase py-2.5 pr-4">
                        <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap w-full">
                          <SlidersHorizontal className="size-3.5 opacity-60 shrink-0" />
                          操作
                        </span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pager.slice.map((p, i) => {
                      const manage = canManageProject(p.my_role, me?.platform_role, p.owner_id, me?.id);
                      return (
                        <TableRow
                          key={p.id}
                          index={i}
                          className="cursor-pointer transition-colors"
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
                          <TableCell className="py-2.5">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span className="size-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 border border-primary/20">
                                <FolderKanban className="size-3.5" />
                              </span>
                              <span className="font-semibold text-foreground text-sm tracking-tight truncate">
                                {p.name}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 w-[180px]">
                            <span className="inline-flex items-center rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-xs text-muted-foreground truncate max-w-[160px]">
                              {p.slug}
                            </span>
                          </TableCell>
                          <TableCell className="py-2.5 w-[220px]">
                            <div
                              className="flex items-center gap-1.5 max-w-[210px]"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span
                                className="font-mono text-xs text-muted-foreground/80 truncate select-all"
                                title={p.id}
                              >
                                {p.id}
                              </span>
                              <Hint label={copiedId === p.id ? "已复制 ID" : "复制完整 ID"}>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="compact"
                                  data-testid="project-copy-id"
                                  onClick={(e) => void onCopyId(e, p.id)}
                                  className={cn(
                                    "size-6 p-0 shrink-0 text-muted-foreground hover:text-foreground transition-colors",
                                    copiedId === p.id && "text-emerald-500 bg-emerald-500/10 font-medium",
                                  )}
                                  aria-label="复制项目 ID"
                                >
                                  {copiedId === p.id ? (
                                    <Check className="size-3 text-emerald-500" />
                                  ) : (
                                    <Copy className="size-3 opacity-70" />
                                  )}
                                </Button>
                              </Hint>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 w-[160px] text-xs text-muted-foreground whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              <Clock className="size-3 opacity-50 shrink-0" />
                              {formatTime(p.created_at)}
                            </span>
                          </TableCell>
                          <TableCell
                            stickyEnd
                            className="text-right py-2.5 w-[180px] pr-4"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                              <Button
                                type="button"
                                variant="ghost"
                                size="compact"
                                data-testid="project-detail"
                                onClick={() => openProject(p)}
                                className="h-7 px-2 text-xs font-medium text-muted-foreground hover:text-foreground shrink-0 inline-flex items-center gap-1"
                              >
                                <ExternalLink className="size-3 opacity-60 shrink-0" />
                                详情
                              </Button>
                              {manage && (
                                <>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="compact"
                                    data-testid="project-edit"
                                    onClick={() => {
                                      setFormErr("");
                                      setEditTarget(p);
                                    }}
                                    className="h-7 px-2 text-xs font-medium text-muted-foreground hover:text-foreground shrink-0 inline-flex items-center gap-1"
                                  >
                                    <Pencil className="size-3 opacity-60 shrink-0" />
                                    编辑
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="compact"
                                    data-testid="project-delete"
                                    onClick={() => setRemoveTarget(p)}
                                    className="h-7 px-2 text-xs font-medium text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0 inline-flex items-center gap-1"
                                  >
                                    <Trash2 className="size-3 opacity-70 shrink-0" />
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
              </div>
            </Elevated>
              }
              cards={pager.slice.map((p) => {
                const manage = canManageProject(p.my_role, me?.platform_role, p.owner_id, me?.id);
                return (
                  <ListCard
                    key={p.id}
                    data-testid="project-row"
                    role="link"
                    tabIndex={0}
                    className="cursor-pointer"
                    onClick={() => openProject(p)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openProject(p);
                      }
                    }}
                  >
                    <ListCardHeader
                      leading={
                        <span className="size-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 border border-primary/20">
                          <FolderKanban className="size-3.5" />
                        </span>
                      }
                      title={p.name}
                    />
                    <ListCardMeta>
                      <span className="inline-flex items-center gap-1 min-w-0">
                        <Tag className="size-3 opacity-60 shrink-0" />
                        <span className="font-mono truncate">{p.slug}</span>
                      </span>
                      <span className="inline-flex items-center gap-1 shrink-0">
                        <Clock className="size-3 opacity-60" />
                        {formatTime(p.created_at)}
                      </span>
                    </ListCardMeta>
                    <ListCardActions>
                      <div
                        className="flex flex-wrap items-center gap-1.5"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <Hint label={copiedId === p.id ? "已复制 ID" : "复制完整 ID"}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="compact"
                            data-testid="project-copy-id"
                            onClick={(e) => void onCopyId(e, p.id)}
                            className={cn(
                              "size-7 p-0 shrink-0 text-muted-foreground hover:text-foreground",
                              copiedId === p.id && "text-emerald-500 bg-emerald-500/10",
                            )}
                            aria-label="复制项目 ID"
                          >
                            {copiedId === p.id ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5 opacity-70" />}
                          </Button>
                        </Hint>
                        <Button
                          type="button"
                          variant="ghost"
                          size="compact"
                          data-testid="project-detail"
                          onClick={() => openProject(p)}
                          className="h-7 px-2 text-xs font-medium inline-flex items-center gap-1 shrink-0"
                        >
                          <ExternalLink className="size-3 opacity-60 shrink-0" />
                          详情
                        </Button>
                        {manage && (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="compact"
                              data-testid="project-edit"
                              onClick={() => {
                                setFormErr("");
                                setEditTarget(p);
                              }}
                              className="h-7 px-2 text-xs font-medium inline-flex items-center gap-1 shrink-0"
                            >
                              <Pencil className="size-3 opacity-60 shrink-0" />
                              编辑
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="compact"
                              data-testid="project-delete"
                              onClick={() => setRemoveTarget(p)}
                              className="h-7 px-2 text-xs font-medium text-destructive hover:bg-destructive/10 hover:text-destructive inline-flex items-center gap-1 shrink-0"
                            >
                              <Trash2 className="size-3 opacity-70 shrink-0" />
                              删除
                            </Button>
                          </>
                        )}
                      </div>
                    </ListCardActions>
                  </ListCard>
                );
              })}
            />
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
