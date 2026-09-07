import { FormEvent, ReactNode, useState } from "react";
import { api, friendlyError } from "../../providers";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Field } from "../../components/ui/field";
import { Alert, AlertDescription } from "../../components/ui/alert";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";

type Props = {
  trigger: ReactNode;
  onImported: () => void;
};

export function ImportKeyDialog({ trigger, onImported }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setName("");
    setPublicKey("");
    setErr("");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await api("/me/ssh-keys", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() || "default", public_key: publicKey.trim() }),
      });
      reset();
      setOpen(false);
      onImported();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>导入 SSH 公钥</DialogTitle>
          <DialogDescription>
            粘贴本机公钥（如 <span className="font-mono text-xs">~/.ssh/id_ed25519.pub</span>
            ）。审批通过后用该密钥经跳板登录隔离环境。
          </DialogDescription>
        </DialogHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
          <DialogBody className="grid gap-4">
            <Field label="名称">
              <Input
                data-testid="ws-keys-name"
                placeholder="例如：笔记本"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field label="公钥">
              <Textarea
                data-testid="ws-keys-pubkey"
                placeholder="ssh-ed25519 AAAA… comment"
                value={publicKey}
                onChange={(e) => setPublicKey(e.target.value)}
                rows={3}
                required
              />
            </Field>
            {err && (
              <Alert variant="destructive">
                <AlertDescription>{err}</AlertDescription>
              </Alert>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button data-testid="ws-keys-add" disabled={busy || !publicKey.trim()} type="submit">
              {busy ? "导入中…" : "导入"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
