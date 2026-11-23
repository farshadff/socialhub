import { PageHeader } from "@refinedev/antd";
import type { PropsWithChildren, ReactNode } from "react";

type PageFrameProps = PropsWithChildren<{
  title: ReactNode;
  /** Optional one-line description under the title. */
  description?: ReactNode;
  /** The page's primary action, shown on the right. */
  extra?: ReactNode;
}>;

/**
 * Frame for every page: title, optional one-line description, primary action.
 * It renders the same header as Refine's CRUD views. A page that is only a
 * full-page create or edit form uses Refine's `Create` / `Edit` instead.
 * See docs/DESIGN-SYSTEM.md section 4.
 */
export function PageFrame({ title, description, extra, children }: PageFrameProps) {
  return (
    <PageHeader ghost={false} title={title} subTitle={description} extra={extra}>
      {children}
    </PageHeader>
  );
}
