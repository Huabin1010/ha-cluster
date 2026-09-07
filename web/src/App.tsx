import { lazy, Suspense } from "react";
import { Refine, Authenticated } from "@refinedev/core";
import routerProvider from "@refinedev/react-router-v6";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { authProvider, dataProvider } from "./providers";
import { Loading, ToastProvider } from "./ui";
import { LoginPage } from "./pages/Login";
import { Layout } from "./pages/Layout";

const ProjectsPage = lazy(() => import("./pages/Projects").then((m) => ({ default: m.ProjectsPage })));
const ProjectDetailPage = lazy(() => import("./pages/projects/Detail").then((m) => ({ default: m.ProjectDetailPage })));
const WorkspacesPage = lazy(() => import("./pages/Workspaces").then((m) => ({ default: m.WorkspacesPage })));
const MembersPage = lazy(() => import("./pages/Members").then((m) => ({ default: m.MembersPage })));
const AcceptInvitePage = lazy(() => import("./pages/AcceptInvite").then((m) => ({ default: m.AcceptInvitePage })));
const NodesPage = lazy(() => import("./pages/Nodes").then((m) => ({ default: m.NodesPage })));
const CapacityPage = lazy(() => import("./pages/ops/Capacity").then((m) => ({ default: m.CapacityPage })));
const SSHKeysPage = lazy(() => import("./pages/ops/SSHKeys").then((m) => ({ default: m.SSHKeysPage })));
const AuditPage = lazy(() => import("./pages/ops/Audit").then((m) => ({ default: m.AuditPage })));

const queryClient = new QueryClient();

function AuthLoading() {
  return (
    <div className="login-wrap">
      <Loading label="校验登录态…" />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Refine
        dataProvider={dataProvider as never}
        authProvider={authProvider as never}
        routerProvider={routerProvider}
        resources={[
          { name: "projects", list: "/projects", show: "/projects/:id" },
          { name: "workspaces", list: "/workspaces" },
          { name: "nodes", list: "/nodes" },
        ]}
        options={{ disableTelemetry: true, syncWithLocation: true }}
      >
        <Routes>
          <Route
            path="/login"
            element={
              <Authenticated key="login" fallback={<LoginPage />} loading={<AuthLoading />}>
                <Navigate to="/projects" replace />
              </Authenticated>
            }
          />
          <Route
            element={
              <Authenticated
                key="app"
                fallback={<Navigate to="/login" replace />}
                loading={<AuthLoading />}
              >
                <Layout>
                  <Suspense fallback={<Loading label="加载页面…" />}>
                    <Outlet />
                  </Suspense>
                </Layout>
              </Authenticated>
            }
          >
            <Route index element={<Navigate to="/projects" replace />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id/members" element={<MembersPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            <Route path="/workspaces" element={<WorkspacesPage />} />
            <Route path="/members" element={<MembersPage />} />
            <Route path="/invitations/accept" element={<AcceptInvitePage />} />
            <Route path="/nodes" element={<NodesPage />} />
            <Route path="/capacity" element={<CapacityPage />} />
            <Route path="/settings/keys" element={<SSHKeysPage />} />
            <Route path="/audit" element={<AuditPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Refine>
    </ToastProvider>
  </QueryClientProvider>
  );
}
