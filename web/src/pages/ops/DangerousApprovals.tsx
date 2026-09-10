import { useCallback, useEffect, useState } from "react";
import { useGetIdentity } from "@refinedev/core";
import { api, friendlyError, type AuthUser } from "../../providers";
import { canApproveDangerousOps } from "../../lib/permissions";
import { statusLabel, Workspace } from "../workspaces/types";
import { Button } from "../../components/ui/button";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { PageFrame } from "../../components/ui/page-frame";
import { Badge } from "../../components/ui/badge";
import { Loading, PageHeader } from "../../ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";

export function DangerousApprovalsPage() {
  const { data: me } = useGetIdentity<AuthUser>();
  const [rows, setRows] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const allowed = canApproveDangerousOps(me?.platform_role);

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setErr("");
    try {
      const json = await api<{ data: Workspace[] }>("/admin/dangerous-approvals");
      setRows(json.data ?? []);
    } catch (e) {
      setErr(friendlyError(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(id: string) {
    setBusyId(id);
    setErr("");
    try {
      await api(`/admin/dangerous-approvals/${id}/approve`, { method: "POST", body: "{}" });
      setConfirmId(null);
      await load();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusyId(null);
    }
  }

  if (!allowed) {
    return (
      <PageFrame header={<PageHeader title="危险操作待审" description="仅平台超级管理员可访问。" />}>
        <Alert variant="destructive">
          <AlertDescription>当前账号无权访问此页。</AlertDescription>
        </Alert>
      </PageFrame>
    );
  }

  return (
    <PageFrame
      header={
        <div className="grid gap-3">
          <PageHeader
            title="危险操作待审"
            description="工作区销毁等项目初审已通过，等待平台超级管理员终审。通过后配额归还并删除隔离环境。"
            actions={
              <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
                刷新
              </Button>
            }
          />
          {err && (
            <Alert variant="destructive">
              <AlertDescription>{err}</AlertDescription>
            </Alert>
          )}
        </div>
      }
    >
      {loading ? (
        <Loading label="加载待审队列…" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无待平台终审的销毁申请。</p>
      ) : (
        <Table data-testid="dangerous-approvals-table">
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>项目</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((w) => (
              <TableRow key={w.id} data-testid="dangerous-approval-row">
                <TableCell>{w.name}</TableCell>
                <TableCell className="mono font-mono text-xs">{w.project_id}</TableCell>
                <TableCell>
                  <Badge variant="warn">{statusLabel(w.status)}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    data-testid="dangerous-approve"
                    disabled={busyId === w.id}
                    onClick={() => setConfirmId(w.id)}
                  >
                    平台终审
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <AlertDialog open={!!confirmId} onOpenChange={(v) => !v && setConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认平台终审销毁</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <AlertDialogDescription>
              此操作不可恢复。工作区将被删除，配额归还账本。
            </AlertDialogDescription>
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="confirm-cancel">取消</AlertDialogCancel>
            <AlertDialogAction
              data-testid="confirm-ok"
              onClick={() => confirmId && void approve(confirmId)}
            >
              确认销毁
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageFrame>
  );
}
