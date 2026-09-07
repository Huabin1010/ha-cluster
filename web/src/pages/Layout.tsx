import { PropsWithChildren, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useGetIdentity, useLogout } from "@refinedev/core";
import { useIsFetching } from "@tanstack/react-query";
import { Button, Loading } from "../ui";

const ENV_LABEL = import.meta.env.PROD ? "prod" : "dev";

export function Layout({ children }: PropsWithChildren) {
  const { mutate } = useLogout();
  const { data: me } = useGetIdentity<{ username?: string }>();
  const fetching = useIsFetching();
  const [navOpen, setNavOpen] = useState(false);
  // First paint / list fetches: show overlay spinner without unmounting the page.
  const showFetchHint = fetching > 0;

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  return (
    <div className={`shell ${navOpen ? "nav-open" : ""}`}>
      <header className="topbar">
        <Button
          type="button"
          variant="ghost"
          className="nav-toggle"
          data-testid="nav-toggle"
          aria-expanded={navOpen}
          aria-controls="app-sidebar"
          onClick={() => setNavOpen((v) => !v)}
        >
          菜单
        </Button>
        <span className="brand-mobile">ha-cluster</span>
        <span className={`env-badge env-${ENV_LABEL}`} data-testid="env-badge" title="运行环境">
          {ENV_LABEL}
        </span>
      </header>

      {navOpen && (
        <button
          type="button"
          className="nav-backdrop"
          aria-label="关闭菜单"
          onClick={() => setNavOpen(false)}
        />
      )}

      <aside id="app-sidebar">
        <div className="brand-row">
          <div className="brand">ha-cluster</div>
          <span className={`env-badge env-${ENV_LABEL}`} data-testid="env-badge">{ENV_LABEL}</span>
        </div>
        <nav onClick={() => setNavOpen(false)}>
          <NavLink data-testid="nav-projects" to="/projects">
            项目
          </NavLink>
          <NavLink data-testid="nav-members" to="/members">成员</NavLink>
          <NavLink data-testid="nav-workspaces" to="/workspaces">Workspace</NavLink>
          <NavLink data-testid="nav-nodes" to="/nodes">节点</NavLink>
          <NavLink data-testid="nav-capacity" to="/capacity">容量</NavLink>
          <NavLink data-testid="nav-keys" to="/settings/keys">SSH 公钥</NavLink>
          <NavLink data-testid="nav-audit" to="/audit">审计</NavLink>
        </nav>
        <div className="aside-foot">
          <span className="muted" data-testid="current-user">
            {me?.username || "—"}
          </span>
          <Button data-testid="logout-button" type="button" variant="ghost" onClick={() => mutate()}>
            退出
          </Button>
        </div>
      </aside>

      <main className="main-pane">
        {showFetchHint && (
          <div className="fetch-hint" aria-live="polite">
            <Loading block={false} label="加载中…" />
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
