import type { ThemeConfig } from "antd";

/**
 * Social Hub panel tokens (docs/DESIGN-SYSTEM.md section 2).
 * This is the only file in the frontend that may contain a literal colour,
 * font family or radius. Everything else reads Ant Design tokens.
 */
export const tokens = {
  colorPrimary: "#1677ff",
  borderRadius: 8,
  fontSize: 14,
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji', Vazirmatn",
} satisfies ThemeConfig["token"];

export const theme: ThemeConfig = {
  token: tokens,
};
