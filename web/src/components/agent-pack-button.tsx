import { useState } from "react";
import { Bot, Copy, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, friendlyError } from "@/providers";
import { copyText } from "@/ui/format";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

type PackMeta = {
  url: string;
  prompt: string;
  prefix?: string;
};

async function issuePack(rotate = false): Promise<PackMeta> {
  if (rotate) {
    return api<PackMeta>("/me/agent-pack", {
      method: "POST",
      body: JSON.stringify({ rotate: true }),
    });
  }
  return api<PackMeta>("/me/agent-pack");
}

async function copyPrompt(meta: PackMeta) {
  const ok = await copyText(meta.prompt);
  if (!ok) throw new Error("clipboard");
}

export function AgentPackButton({ rail }: { rail: boolean }) {
  const [busy, setBusy] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);

  const runCopy = async (rotate: boolean) => {
    setBusy(true);
    try {
      const meta = await issuePack(rotate);
      await copyPrompt(meta);
      toast.success(rotate ? "已轮换并复制新的 Agent 接入" : "已复制 Agent 接入，发给 Cursor 即可安装");
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  if (rail) {
    return (
      <>
        <Hint label="复制 Agent 接入" side="right">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            data-testid="nav-agent-pack"
            aria-label="复制 Agent 接入"
            disabled={busy}
            onClick={() => void runCopy(false)}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Bot className="size-3.5" />}
          </Button>
        </Hint>
        <Hint label="轮换 Agent 密钥" side="right">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            data-testid="nav-agent-pack-rotate"
            aria-label="轮换 Agent 密钥"
            disabled={busy}
            onClick={() => setRotateOpen(true)}
          >
            <KeyRound className="size-3.5" />
          </Button>
        </Hint>
        <RotateDialog open={rotateOpen} onOpenChange={setRotateOpen} onConfirm={() => void runCopy(true)} />
      </>
    );
  }

  return (
    <div className="px-1" data-testid="nav-agent-pack-card">
      <div className="rounded-lg border border-border/70 bg-surface-2/40 p-2">
        <div className="mb-1.5 flex items-center gap-1.5 text-foreground">
          <Bot className="size-3.5 shrink-0 opacity-70" />
          <span className="text-[12px] font-medium whitespace-nowrap">Agent 接入</span>
        </div>
        <p className="mb-2 break-words min-w-0 text-[11px] leading-4 text-muted-foreground">
          复制一段给 Cursor：只用 curl 拉取专属 skill / rule，并以你的身份操作。
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="compact"
            className="inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
            data-testid="nav-agent-pack"
            disabled={busy}
            onClick={() => void runCopy(false)}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Copy className="size-3.5 shrink-0" />}
            复制专属链接
          </Button>
          <Hint label="轮换密钥，旧链接立刻失效">
            <Button
              type="button"
              variant="ghost"
              size="compact"
              className="inline-flex size-7 items-center justify-center p-0 shrink-0"
              data-testid="nav-agent-pack-rotate"
              aria-label="轮换 Agent 密钥"
              disabled={busy}
              onClick={() => setRotateOpen(true)}
            >
              <KeyRound className="size-3.5" />
            </Button>
          </Hint>
        </div>
      </div>
      <RotateDialog open={rotateOpen} onOpenChange={setRotateOpen} onConfirm={() => void runCopy(true)} />
    </div>
  );
}

function RotateDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>轮换 Agent 密钥？</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogBody>
          <AlertDialogDescription className="break-words min-w-0">
            已经发给 Cursor 的旧链接会立刻失效。新密钥会复制到剪贴板，需要重新发给 Agent 安装。
          </AlertDialogDescription>
        </AlertDialogBody>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className={cn("inline-flex items-center")}
            onClick={onConfirm}
          >
            轮换并复制
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
