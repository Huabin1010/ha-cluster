import { useEffect, useState } from "react";
import { api, friendlyError } from "../../providers";
import { Empty, PageBody } from "../../ui";
import { fmtBytes, fmtCPU } from "./format";

type Pool = {
  arch: string;
  cpu_milli_free: number;
  mem_bytes_free: number;
  disk_bytes_free: number;
};

export function CapacityPage() {
  const [pools, setPools] = useState<Pool[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const json = await api<{ pools: Pool[] }>("/capacity");
        if (!cancelled) setPools(json.pools ?? []);
      } catch (e) {
        if (!cancelled) setErr(friendlyError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section>
      <h2>容量池</h2>
      <p className="muted">按 arch 汇总 Ready worker 的可售 CPU / 内存 / 磁盘（不能混卖）。</p>
      {err && <p className="error">{err}</p>}
      <PageBody loading={loading}>
        {pools.length === 0 ? (
          <Empty text="暂无可用容量池（可能没有 Ready 的 worker 节点）。" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>arch</th>
                <th>空闲 CPU</th>
                <th>空闲内存</th>
                <th>空闲磁盘</th>
              </tr>
            </thead>
            <tbody>
              {pools.map((p) => (
                <tr key={p.arch} data-testid="capacity-row">
                  <td className="mono">{p.arch}</td>
                  <td>
                    {fmtCPU(p.cpu_milli_free)}{" "}
                    <span className="muted tiny">({p.cpu_milli_free} milli)</span>
                  </td>
                  <td>{fmtBytes(p.mem_bytes_free)}</td>
                  <td>{fmtBytes(p.disk_bytes_free)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PageBody>
    </section>
  );
}
