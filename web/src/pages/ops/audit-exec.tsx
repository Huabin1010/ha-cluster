import { Copy, Terminal } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Hint, Tooltip } from "@/components/ui/tooltip";
import { popupLayerClass } from "@/lib/popup";
import { copyText } from "@/ui/format";
import { cn } from "@/lib/utils";
import {
  actionLabel,
  auditExecDetail,
  formatAuditExecOutput,
  type AuditMeta,
} from "./format";

const panePreClass =
  "m-0 min-w-0 whitespace-pre-wrap break-all wrap-anywhere font-mono text-[12px] leading-relaxed text-foreground";

function ExecPane({
  title,
  testId,
  text,
  empty,
  onCopy,
}: {
  title: string;
  testId: string;
  text: string;
  empty?: boolean;
  onCopy: () => void;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/70 bg-surface-2/40">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Terminal className="size-3.5 shrink-0 opacity-60" />
          {title}
        </span>
        <Hint label="复制">
          <Button
            type="button"
            variant="ghost"
            size="compact"
            className="size-7 p-0 shrink-0"
            aria-label={`复制${title}`}
            onClick={() => void onCopy()}
          >
            <Copy className="size-3.5 opacity-70 shrink-0" />
          </Button>
        </Hint>
      </header>
      <ScrollArea className="relative min-h-0 flex-1" viewportClassName="h-full p-3">
        <pre data-testid={testId} className={cn(panePreClass, empty && "text-muted-foreground")}>
          {text}
        </pre>
      </ScrollArea>
    </section>
  );
}

export function AuditExecCommandButton({ command, onOpen }: { command: string; onOpen: () => void }) {
  if (!command) return null;
  return (
    <Tooltip
      side="top"
      contentClassName={popupLayerClass}
      className="max-h-48 max-w-md overflow-auto p-2 font-mono text-[11px] leading-snug whitespace-pre-wrap break-all wrap-anywhere text-foreground"
      content={command}
    >
      <button
        type="button"
        data-testid="audit-exec-command"
        className="mt-0.5 w-full min-w-0 max-w-full cursor-pointer rounded-md text-left font-mono text-[12px] leading-snug text-foreground line-clamp-2 break-all wrap-anywhere whitespace-pre-wrap hover:text-primary"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpen();
        }}
      >
        {command}
      </button>
    </Tooltip>
  );
}

export function AuditExecResultDialog({
  open,
  onOpenChange,
  action,
  meta,
  resourceName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: string;
  meta?: AuditMeta;
  resourceName: string;
}) {
  const detail = auditExecDetail(action, meta);
  const output = formatAuditExecOutput(detail);
  const failed = action.endsWith(".deny") || (detail.exitCode != null && detail.exitCode !== 0);
  const emptyOutput = !detail.hasRecordedOutput || (!detail.stdout && !detail.stderr && !detail.error);

  async function copy(label: string, value: string) {
    const ok = await copyText(value);
    if (!ok) {
      toast.error("复制失败，请手动选中");
      return;
    }
    toast.success(`已复制${label}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="sm:max-w-5xl h-[min(82dvh,720px)]" data-testid="audit-exec-dialog">
        <DialogHeader>
          <DialogTitle>命令执行结果</DialogTitle>
          <DialogDescription className="min-w-0 break-words">
            {actionLabel(action)}
            {resourceName ? ` · ${resourceName}` : ""}
          </DialogDescription>
          {detail.exitCode != null || failed ? (
            <div className="pt-1">
              {detail.exitCode != null ? (
                <Hint label="exit_code" className="font-mono">
                  <Badge
                    variant={failed ? "danger" : "ok"}
                    className="inline-flex items-center whitespace-nowrap shrink-0"
                  >
                    退出码 {detail.exitCode}
                  </Badge>
                </Hint>
              ) : (
                <Badge variant="danger" className="inline-flex items-center whitespace-nowrap shrink-0">
                  执行失败
                </Badge>
              )}
            </div>
          ) : null}
        </DialogHeader>
        <DialogBody className="flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-hidden md:flex-row md:gap-4">
          {failed && detail.error ? (
            <Alert variant="destructive" className="md:hidden min-w-0">
              <AlertDescription className="min-w-0 break-words text-foreground">{detail.error}</AlertDescription>
            </Alert>
          ) : null}
          <ExecPane
            title="输入"
            testId="audit-exec-input"
            text={detail.command || "（无命令）"}
            empty={!detail.command}
            onCopy={() => copy("命令", detail.command)}
          />
          <ExecPane
            title="输出"
            testId="audit-exec-output"
            text={output}
            empty={emptyOutput}
            onCopy={() => copy("输出", output)}
          />
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
