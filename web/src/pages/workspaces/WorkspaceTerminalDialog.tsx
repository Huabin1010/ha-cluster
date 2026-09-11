import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

function terminalURL(workspaceId: string, token: string) {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const q = new URLSearchParams({ access_token: token });
  return `${proto}//${window.location.host}/api/workspaces/${workspaceId}/terminal?${q.toString()}`;
}

export function WorkspaceTerminalDialog({
  workspaceId,
  workspaceName,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  workspaceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let term: Terminal | null = null;
    let ws: WebSocket | null = null;
    let ro: ResizeObserver | null = null;
    let raf = 0;

    const start = () => {
      const host = hostRef.current;
      if (!host) {
        raf = requestAnimationFrame(start);
        return;
      }
      if (cancelled) return;

      const token = localStorage.getItem("ha_token") || "";
      term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        theme: {
          background: "#0b1220",
          foreground: "#e5e7eb",
          cursor: "#22c55e",
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      fit.fit();
      term.writeln("正在连接…");

      if (!token) {
        term.writeln("未登录，无法连接终端。");
        return;
      }

      const socket = new WebSocket(terminalURL(workspaceId, token));
      socket.binaryType = "arraybuffer";
      ws = socket;
      let opened = false;

      const sendResize = () => {
        fit.fit();
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "resize", cols: term!.cols, rows: term!.rows }));
        }
      };

      socket.onopen = () => {
        opened = true;
        term?.reset();
        sendResize();
      };
      socket.onmessage = (ev) => {
        if (!term) return;
        if (typeof ev.data === "string") {
          term.write(ev.data.replace(/\n/g, "\r\n"));
          return;
        }
        term.write(new Uint8Array(ev.data as ArrayBuffer));
      };
      socket.onerror = () => {
        term?.writeln("\r\n连接失败。");
      };
      socket.onclose = () => {
        if (opened) term?.writeln("\r\n会话已结束。");
        else term?.writeln("\r\n无法建立终端会话（无权限或机器未运行）。");
      };
      term.onData((data) => {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(new TextEncoder().encode(data));
      });

      ro = new ResizeObserver(() => sendResize());
      ro.observe(host);
    };

    raf = requestAnimationFrame(start);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      ws?.close();
      term?.dispose();
    };
  }, [open, workspaceId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="xl"
        className="flex h-[min(80vh,720px)] max-w-[min(96vw,1100px)] flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="shrink-0 border-b border-border/70 px-4 py-3">
          <DialogTitle className="inline-flex items-center gap-2">
            网页终端
            <Badge variant="outline" className="font-mono font-normal">
              {workspaceName}
            </Badge>
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="min-h-0 flex-1 overflow-hidden bg-[#0b1220] p-2">
          <div ref={hostRef} className="h-full w-full" data-testid="ws-terminal" />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
