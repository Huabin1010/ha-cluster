import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isValidPurpose, isValidSlug, PURPOSE_MAX, suggestSlugFromName } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial?: { name: string; slug: string; purpose?: string };
  submitting?: boolean;
  error?: string;
  onSubmit: (name: string, slug: string, purpose: string) => void;
};

export function ProjectFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  submitting,
  error,
  onSubmit,
}: Props) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [purpose, setPurpose] = useState("");
  const [localErr, setLocalErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setSlug(initial?.slug ?? "");
    setPurpose(initial?.purpose ?? "");
    setLocalErr("");
  }, [open, initial?.name, initial?.slug, initial?.purpose]);

  function onNameChange(v: string) {
    setName(v);
    if (!slug || slug === suggestSlugFromName(name)) {
      setSlug(suggestSlugFromName(v));
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalErr("");
    const n = name.trim();
    const s = slug.trim().toLowerCase();
    const p = purpose.trim().replace(/\s+/g, " ");
    if (!n) {
      setLocalErr("请填写项目名称");
      return;
    }
    if (!isValidSlug(s)) {
      setLocalErr("slug 须为小写字母、数字与短横线（如 my-app）");
      return;
    }
    if (!isValidPurpose(p, n, s)) {
      setLocalErr("请用一句话说明这个项目是干什么的（2–80 字，不要复述名称或 slug）");
      return;
    }
    onSubmit(n, s, p);
  }

  const err = localErr || error || "";
  const create = mode === "create";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{create ? "创建项目" : "编辑项目"}</DialogTitle>
          <DialogDescription>
            {create
              ? "填写名称、slug 与用途。用途一句话说清这个项目是干什么的。"
              : "修改显示名称、slug 或用途。slug 须全局唯一。"}
          </DialogDescription>
        </DialogHeader>
        <form
          id={create ? "project-create-form" : "project-edit-form"}
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={handleSubmit}
          data-testid={create ? "project-create-form" : "project-edit-form"}
        >
          <DialogBody className="grid gap-4">
            <Field label="名称">
              <Input
                data-testid="project-name"
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="办公零食"
                required
              />
            </Field>
            <Field label="slug">
              <Input
                data-testid="project-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                placeholder="office-snacks"
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                title="小写字母、数字与短横线"
                required
              />
            </Field>
            <Field label="用途">
              <Input
                data-testid="project-purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="办公室零食柜与内部协作"
                maxLength={PURPOSE_MAX}
                required
              />
              <p className="text-xs text-muted-foreground break-words min-w-0">
                必填，2–80 字。一句话说清这个项目是干什么的，不要只重复名称。
              </p>
            </Field>
            {err && (
              <Alert variant="destructive" data-testid="project-error">
                <AlertDescription>{err}</AlertDescription>
              </Alert>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button data-testid={create ? "project-create" : "project-save"} disabled={submitting} type="submit">
              {submitting ? (create ? "创建中…" : "保存中…") : create ? "创建" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
