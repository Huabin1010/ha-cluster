type Props = {
  label?: string;
  /** full main-area overlay vs inline spinner */
  block?: boolean;
};

export function Loading({ label = "加载中…", block = true }: Props) {
  return (
    <div
      className={block ? "loading-block" : "loading-inline"}
      role="status"
      aria-live="polite"
      data-testid="page-loading"
    >
      <span className="spinner" aria-hidden />
      <span className="muted">{label}</span>
    </div>
  );
}

/** Simple skeleton bars for list/table placeholders */
export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-hidden data-testid="page-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" style={{ width: `${88 - (i % 3) * 12}%` }} />
      ))}
    </div>
  );
}
