import { Refine, Authenticated } from "@refinedev/core";
import routerProvider from "@refinedev/react-router-v6";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { authProvider, dataProvider } from "./providers";
import { Loading, ToastProvider } from "./ui";
import { LoginPage } from "./pages/Login";
import { Layout } from "./pages/Layout";
import { ProjectsPage } from "./pages/Projects";
import { ProjectDetailPage } from "./pages/projects/Detail";
import { WorkspacesPage } from "./pages/Workspaces";
import { MembersPage } from "./pages/Members";
import { AcceptInvitePage } from "./pages/AcceptInvite";
import { NodesPage } from "./pages/Nodes";
import { CapacityPage } from "./pages/ops/Capacity";
import { SSHKeysPage } from "./pages/ops/SSHKeys";
import { AuditPage } from "./pages/ops/Audit";

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
                  <Outlet />
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
