import { FormEvent, useEffect, useState } from "react";
import { api, friendlyError } from "../../providers";
import { Button, Empty, PageBody, useToast } from "../../ui";
import { fmtTime } from "./format";

type SSHKey = {
  id: string;
  name: string;
  public_key: string;
  fingerprint: string;
  created_at: string;
};

export function SSHKeysPage() {
  const { push } = useToast();
  const [keys, setKeys] = useState<SSHKey[]>([]);
  const [name, setName] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const json = await api<{ data: SSHKey[] }>("/me/ssh-keys");
      setKeys(json.data ?? []);
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErr("");
    try {
      await api("/me/ssh-keys", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() || "default", public_key: publicKey.trim() }),
      });
      setName("");
      setPublicKey("");
      push("success", "公钥已添加");
      await load();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("确定删除此公钥？")) return;
    setErr("");
    try {
      await api(`/me/ssh-keys/${id}`, { method: "DELETE" });
      push("success", "公钥已删除");
      await load();
    } catch (e) {
      setErr(friendlyError(e));
    }
  }

  return (
    <section>
      <h2>SSH 公钥</h2>
      <p className="muted">添加的公钥会用于跳板 / Workspace SSH 登录。</p>
      {err && <p className="error">{err}</p>}

      <form className="keys-form" onSubmit={onSubmit}>
        <label>
          名称
          <input
            data-testid="keys-name"
            placeholder="例如：MacBook"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          公钥
          <textarea
            data-testid="keys-pubkey"
            placeholder="ssh-ed25519 AAAA… comment"
            value={publicKey}
            onChange={(e) => setPublicKey(e.target.value)}
            rows={3}
            required
          />
        </label>
        <Button data-testid="keys-add" disabled={submitting || !publicKey.trim()} type="submit">
          {submitting ? "添加中…" : "添加公钥"}
        </Button>
      </form>

      <PageBody loading={loading}>
        {keys.length === 0 ? (
          <Empty text="还没有公钥，添加一条以便 SSH 登录。" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>fingerprint</th>
                <th>添加时间</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} data-testid="keys-row">
                  <td>{k.name || "—"}</td>
                  <td className="mono">{k.fingerprint}</td>
                  <td>{fmtTime(k.created_at)}</td>
                  <td>
                    <Button data-testid="keys-remove" variant="ghost" type="button" onClick={() => void remove(k.id)}>
                      删除
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PageBody>
    </section>
  );
}
