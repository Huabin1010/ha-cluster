import { FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
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
} from "../../components/ui/dialog";
import { isValidSlug, suggestSlugFromName } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial?: { name: string; slug: string };
  submitting?: boolean;
  error?: string;
  onSubmit: (name: string, slug: string) => void;
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
  const [localErr, setLocalErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setSlug(initial?.slug ?? "");
    setLocalErr("");
  }, [open, initial?.name, initial?.slug]);

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
    if (!n) {
      setLocalErr("请填写项目名称");
      return;
    }
    if (!isValidSlug(s)) {
      setLocalErr("slug 须为小写字母、数字与短横线（如 my-app）");
      return;
    }
    onSubmit(n, s);
  }

  const err = localErr || error || "";
  const create = mode === "create";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{create ? "创建项目" : "编辑项目"}</DialogTitle>
          <DialogDescription>
            {create ? "填写名称与 slug，创建后进入详情页。" : "修改显示名称或 slug。slug 须全局唯一。"}
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
                placeholder="演示项目"
                required
              />
            </Field>
            <Field label="slug">
              <Input
                data-testid="project-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                placeholder="demo-app"
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                title="小写字母、数字与短横线"
                required
              />
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
