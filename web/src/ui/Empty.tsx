type Props = {
  /** Preferred short empty-state copy used by U2–U5 pages */
  text?: string;
  title?: string;
  description?: string;
};

export function Empty({ text, title, description }: Props) {
  const heading = title || text || "暂无数据";
  return (
    <div className="empty" data-testid="empty-state">
      <p className="empty-title">{heading}</p>
      {description && <p className="muted">{description}</p>}
    </div>
  );
}
