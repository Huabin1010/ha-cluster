import { FormEvent, MouseEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCreate, useList } from "@refinedev/core";
import { Empty } from "../ui/Empty";
import { friendlyError } from "../providers";
import { copyText, formatTime } from "./projects/format";
import { isValidSlug, type Project } from "./projects/types";

export function ProjectsPage() {
  const navigate = useNavigate();
  const { data, isLoading, refetch } = useList<Project>({ resource: "projects" });
  const { mutate, isLoading: creating } = useCreate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [err, setErr] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  function suggestSlugFromName(n: string) {
    return n
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
  }

  function onNameChange(v: string) {
    setName(v);
    if (!slug || slug === suggestSlugFromName(name)) {
      setSlug(suggestSlugFromName(v));
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    const n = name.trim();
    const s = slug.trim().toLowerCase();
    if (!n) {
      setErr("请填写项目名称");
      return;
    }
    if (!isValidSlug(s)) {
      setErr("slug 须为小写字母、数字与短横线（如 my-app）");
      return;
    }
    mutate(
      { resource: "projects", values: { name: n, slug: s } },
      {
        onSuccess: (res) => {
          setName("");
          setSlug("");
          void refetch();
          const id = (res?.data as Project | undefined)?.id;
          if (id) navigate(`/projects/${id}`);
        },
        onError: (e) => {
          const raw = e instanceof Error ? e.message : String(e);
          if (raw === "conflict" || raw.includes("conflict")) {
            setErr("slug 已被占用，请换一个");
            return;
          }
          setErr(friendlyError(e));
        },
      },
    );
  }

  async function onCopyId(e: MouseEvent, id: string) {
    e.stopPropagation();
    const ok = await copyText(id);
    if (ok) {
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    }
  }

  const rows = data?.data ?? [];

  return (
    <section>
      <h2>项目</h2>
      <p className="muted">创建后可在详情页查看用量、编辑预算，并跳转创建 Workspace。</p>

      <form className="row wrap" onSubmit={onSubmit} data-testid="project-create-form">
        <label>
          名称
          <input
            data-testid="project-name"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="演示项目"
            required
          />
        </label>
        <label>
          slug
          <input
            data-testid="project-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            placeholder="demo-app"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            title="小写字母、数字与短横线"
            required
          />
        </label>
        <button data-testid="project-create" disabled={creating} type="submit">
          {creating ? "创建中…" : "创建"}
        </button>
      </form>
      {err && (
        <p className="error" data-testid="project-error">
          {err}
        </p>
      )}

      {isLoading ? (
        <p className="muted">加载中…</p>
      ) : rows.length === 0 ? (
        <Empty text="还没有项目，创建一个" />
      ) : (
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>slug</th>
              <th>id</th>
              <th>创建时间</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr
                key={p.id}
                className="clickable"
                data-testid="project-row"
                onClick={() => navigate(`/projects/${p.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(`/projects/${p.id}`);
                  }
                }}
                tabIndex={0}
                role="link"
              >
                <td>{p.name}</td>
                <td>{p.slug}</td>
                <td>
                  <span className="mono">{p.id}</span>{" "}
                  <button
                    type="button"
                    className="ghost compact"
                    data-testid="project-copy-id"
                    onClick={(e) => void onCopyId(e, p.id)}
                    aria-label="复制项目 id"
                  >
                    {copiedId === p.id ? "已复制" : "复制"}
                  </button>
                </td>
                <td className="muted">{formatTime(p.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
