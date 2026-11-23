import { MoonOutlined, SunOutlined } from "@ant-design/icons";
import type { RefineThemedLayoutHeaderProps } from "@refinedev/antd";
import { Layout, Space, Switch, theme } from "antd";
import { useColorMode } from "../contexts/color-mode";

/**
 * Top bar. E00-S02 adds the account switcher, attention count and user menu
 * (docs/DESIGN-SYSTEM.md section 4).
 */
export function Header({ sticky = true }: RefineThemedLayoutHeaderProps) {
  const { token } = theme.useToken();
  const { mode, setMode } = useColorMode();

  return (
    <Layout.Header
      style={{
        backgroundColor: token.colorBgElevated,
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        padding: `0 ${token.paddingLG}px`,
        height: 64,
        ...(sticky ? { position: "sticky", top: 0, zIndex: 1 } : {}),
      }}
    >
      <Space>
        <Switch
          aria-label="Dark theme"
          checked={mode === "dark"}
          checkedChildren={<MoonOutlined />}
          unCheckedChildren={<SunOutlined />}
          onChange={(checked) => setMode(checked ? "dark" : "light")}
        />
      </Space>
    </Layout.Header>
  );
}
