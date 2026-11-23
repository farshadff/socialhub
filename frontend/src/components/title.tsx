import { ThemedTitle } from "@refinedev/antd";
import type { TitleProps } from "@refinedev/core";

/** Logo and product name for the sidebar header (docs/DESIGN-SYSTEM.md section 1). */
export function Title({ collapsed }: TitleProps) {
  return (
    <ThemedTitle
      collapsed={collapsed}
      text="Social Hub"
      icon={<img src="/socialhub.svg" alt="" width={24} height={24} />}
    />
  );
}
