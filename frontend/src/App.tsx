import { DashboardOutlined } from "@ant-design/icons";
import {
  ErrorComponent,
  ThemedLayout,
  ThemedSider,
  useNotificationProvider,
} from "@refinedev/antd";
import { Refine } from "@refinedev/core";
import routerProvider, {
  DocumentTitleHandler,
  UnsavedChangesNotifier,
} from "@refinedev/react-router";
import { App as AntdApp } from "antd";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router";
import "@ant-design/v5-patch-for-react-19";
import "@refinedev/antd/dist/reset.css";

import { Header } from "./components/header";
import { Title } from "./components/title";
import { ColorModeProvider } from "./contexts/color-mode";
import { OverviewPage } from "./pages/overview";
import { socialHubDataProvider } from "./providers/data-provider";

/**
 * Sidebar items. E00-S02 replaces this with the full navigation map in
 * docs/DESIGN-SYSTEM.md section 5.
 */
const resources = [
  {
    name: "overview",
    list: "/overview",
    meta: { label: "Overview", icon: <DashboardOutlined /> },
  },
];

/** Browser tab title: "{Page title} · Social Hub" (docs/DESIGN-SYSTEM.md section 1). */
function documentTitle({ resource }: { resource?: { meta?: { label?: string }; name?: string } }) {
  const page = resource?.meta?.label ?? resource?.name;
  return page ? `${page} · Social Hub` : "Social Hub";
}

export default function App() {
  return (
    <BrowserRouter>
      <ColorModeProvider>
        <AntdApp>
          <Refine
            routerProvider={routerProvider}
            dataProvider={socialHubDataProvider()}
            notificationProvider={useNotificationProvider}
            resources={resources}
            options={{
              syncWithLocation: true,
              warnWhenUnsavedChanges: true,
              disableTelemetry: true,
              title: {
                text: "Social Hub",
                icon: <img src="/socialhub.svg" alt="" width={24} height={24} />,
              },
            }}
          >
            <Routes>
              <Route
                element={
                  <ThemedLayout
                    Header={Header}
                    Title={Title}
                    Sider={(props) => <ThemedSider {...props} fixed />}
                  >
                    <Outlet />
                  </ThemedLayout>
                }
              >
                <Route index element={<Navigate to="/overview" replace />} />
                <Route path="/overview" element={<OverviewPage />} />
                <Route path="*" element={<ErrorComponent />} />
              </Route>
            </Routes>
            <UnsavedChangesNotifier />
            <DocumentTitleHandler handler={documentTitle} />
          </Refine>
        </AntdApp>
      </ColorModeProvider>
    </BrowserRouter>
  );
}
