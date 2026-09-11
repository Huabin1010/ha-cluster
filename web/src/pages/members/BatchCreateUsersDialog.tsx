import { useMemo, useState } from "react";
import { Users, CheckCircle2, XCircle, Sparkles, RefreshCw } from "lucide-react";
import { api, friendlyError } from "@/providers";
import { ASSIGNABLE_ROLES, roleLabel } from "./roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SelectBox } from "@/components/ui/select";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ParsedUser = {
  username: string;
  email: string;
  password?: string;
  lineNo: number;
  raw: string;
  error?: string;
};

export type BatchResultItem = {
  username: string;
  email: string;
  success: boolean;
  user_id?: string;
  added_to_project?: boolean;
  error?: string;
};

export type BatchResult = {
  total: number;
  created_count: number;
  failed_count: number;
  results: BatchResultItem[];
};

export type BatchCreateUsersDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentProjectId?: string;
  currentProjectName?: string;
  onSuccess?: () => void;
  projects?: Array<{ id: string; name: string; slug?: string }>;
};

const SAMPLE_TEXT = `dev_alice alice@example.com ha123456
dev_bob bob@example.com
dev_charlie charlie@example.com`;

export function parseBatchInput(text: string): { parsed: ParsedUser[]; invalidCount: number } {
  const lines = text.split("\n");
  const parsed: ParsedUser[] = [];
  let invalidCount = 0;

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;

    // 分隔符支持逗号、Tab 制表符或多个空格
    const parts = line.split(/[,\t\s]+/).filter(Boolean);
    if (parts.length >= 2) {
      const username = parts[0];
      const email = parts[1];
      const password = parts[2] || undefined;
      let error: string | undefined;

      if (!email.includes("@")) {
        error = "邮箱格式不正确";
        invalidCount++;
      } else if (password && password.length < 6) {
        error = "密码长度小于 6 位";
        invalidCount++;
      }

      parsed.push({
        username,
        email,
        password,
        lineNo: idx + 1,
        raw: line,
        error,
      });
    } else {
      invalidCount++;
      parsed.push({
        username: parts[0] || "",
        email: "",
        lineNo: idx + 1,
        raw: line,
        error: "格式不完整，需包含用户名和邮箱",
      });
    }
  });

  return { parsed, invalidCount };
}

export function BatchCreateUsersDialog({
  open,
  onOpenChange,
  currentProjectId,
  currentProjectName,
  onSuccess,
  projects = [],
}: BatchCreateUsersDialogProps) {
  const [text, setText] = useState("");
  const [defaultPassword, setDefaultPassword] = useState("ha123456");
  const [addToProject, setAddToProject] = useState(true);
  const [targetProjectId, setTargetProjectId] = useState(currentProjectId || "");
  const [projectRole, setProjectRole] = useState("developer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);

  // 解析文本
  const { parsed, invalidCount } = useMemo(() => parseBatchInput(text), [text]);
  const validUsers = useMemo(() => parsed.filter((u) => !u.error && u.username && u.email), [parsed]);

  function handleReset() {
    setBatchResult(null);
    setError("");
  }

  function handleFillSample() {
    setText(SAMPLE_TEXT);
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (validUsers.length === 0) {
      setError("请至少录入一个有效的用户信息（用户名 邮箱）");
      return;
    }

    const effectiveProjectId = currentProjectId || (addToProject && targetProjectId ? targetProjectId : undefined);

    setBusy(true);
    try {
      const payload = {
        users: validUsers.map((u) => ({
          username: u.username,
          email: u.email,
          ...(u.password ? { password: u.password } : {}),
        })),
        default_password: defaultPassword.trim() || undefined,
        ...(effectiveProjectId ? { project_id: effectiveProjectId, project_role: projectRole } : {}),
      };

      const res = await api<BatchResult>("/users/batch", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setBatchResult(res);
      if (onSuccess && res.created_count > 0) {
        onSuccess();
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  function handleClose() {
    onOpenChange(false);
    // 重置状态
    setTimeout(() => {
      setBatchResult(null);
      setError("");
      setText("");
    }, 200);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="sm:max-w-2xl" data-testid="batch-create-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            批量创建用户
          </DialogTitle>
          <DialogDescription>
            管理员可批量创建系统账号，并选择自动加入指定项目。
          </DialogDescription>
        </DialogHeader>

        {batchResult ? (
          <div className="grid gap-4 py-2" data-testid="batch-create-result">
            <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-4">
              <div>
                <p className="font-semibold text-foreground text-sm">批量创建完成</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  共提交 {batchResult.total} 个账号
                </p>
              </div>
              <div className="flex gap-2">
                <Badge variant="ok">成功: {batchResult.created_count}</Badge>
                {batchResult.failed_count > 0 && (
                  <Badge variant="danger">失败: {batchResult.failed_count}</Badge>
                )}
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>用户名</TableHead>
                    <TableHead>邮箱</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>详情</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batchResult.results.map((r, i) => (
                    <TableRow key={i} data-testid="batch-create-result-item">
                      <TableCell className="font-mono text-xs">{r.username}</TableCell>
                      <TableCell className="text-xs">{r.email}</TableCell>
                      <TableCell>
                        {r.success ? (
                          <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-3.5 w-3.5" /> 成功
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400">
                            <XCircle className="h-3.5 w-3.5" /> 失败
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.success
                          ? r.added_to_project
                            ? "创建成功并加入项目"
                            : "账号创建成功"
                          : r.error || "未知错误"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={handleReset}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> 继续创建
              </Button>
              <Button type="button" onClick={handleClose}>
                完成
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <DialogBody className="grid gap-4 overflow-x-hidden overflow-y-auto max-w-full">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="默认初始密码">
                  <Input
                    type="text"
                    data-testid="batch-create-default-password"
                    value={defaultPassword}
                    onChange={(e) => setDefaultPassword(e.target.value)}
                    placeholder="至少 6 位，如 ha123456"
                    required
                  />
                  <p className="text-xs text-muted-foreground m-0">未单独指定密码的行将自动使用此密码</p>
                </Field>

                {currentProjectId ? (
                  <Field label="项目关联">
                    <div className="flex h-9 items-center gap-2">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={addToProject}
                          onChange={(e) => setAddToProject(e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-primary"
                        />
                        同时加入当前项目
                      </label>
                      {addToProject && (
                        <div className="w-28 ml-auto">
                          <SelectBox
                            testId="batch-create-role-select"
                            value={projectRole}
                            onValueChange={setProjectRole}
                            options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))}
                          />
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground m-0">
                      自动将创建的用户加入 {currentProjectName || currentProjectId}
                    </p>
                  </Field>
                ) : (
                  projects.length > 0 && (
                    <Field label="分配至项目 (可选)">
                      <div className="flex gap-2">
                        <SelectBox
                          testId="batch-create-project-select"
                          value={targetProjectId || "__none__"}
                          onValueChange={(v) => setTargetProjectId(v === "__none__" ? "" : v)}
                          options={[
                            { value: "__none__", label: "— 不加入项目（仅创建账号） —" },
                            ...projects.map((p) => ({
                              value: p.id,
                              label: p.name,
                            })),
                          ]}
                        />
                        {targetProjectId && (
                          <div className="w-28">
                            <SelectBox
                              testId="batch-create-role-select"
                              value={projectRole}
                              onValueChange={setProjectRole}
                              options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))}
                            />
                          </div>
                        )}
                      </div>
                    </Field>
                  )
                )}
              </div>

              <Field label="用户列表（一行一条，格式：用户名 邮箱 [密码]）">
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {validUsers.length > 0 && (
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium mr-2">
                          已识别 {validUsers.length} 位有效用户
                        </span>
                      )}
                      {invalidCount > 0 && (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">
                          {invalidCount} 行格式异常
                        </span>
                      )}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={handleFillSample}
                      >
                        <Sparkles className="mr-1 h-3 w-3 text-primary" />
                        填入示例
                      </Button>
                      {text && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => setText("")}
                        >
                          清空
                        </Button>
                      )}
                    </div>
                  </div>
                  <Textarea
                    data-testid="batch-create-textarea"
                    rows={6}
                    className="font-mono text-xs leading-relaxed"
                    placeholder={`# 示例：用户名 邮箱 [自定义密码]\nalice alice@example.com\nbob bob@example.com secret123\ncarol carol@example.com`}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                </div>
              </Field>
            </DialogBody>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button
                data-testid="batch-create-submit"
                type="submit"
                disabled={busy || validUsers.length === 0}
              >
                {busy ? "创建中..." : `批量创建 (${validUsers.length})`}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
