import { Alert, Typography, theme } from 'antd';
import React from 'react';
import type { ValidationIssue } from '@/services/socialhub/briefs';
import { fieldDomId, issueText, targetIds } from './scriptModel';

/** Scrolls to the field an issue points at and focuses it; falls back to its card or section. */
export function focusField(path: string, isImage: boolean) {
  for (const id of targetIds(path, isImage)) {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ block: 'center', behavior: 'smooth' });
      element.focus({ preventScroll: true });
      return true;
    }
  }
  return false;
}

export type ProblemsAlertProps = {
  issues: ValidationIssue[];
  /** API field errors that match no field, shown as plain lines. */
  extra?: string[];
  isImage: boolean;
  /** Read-only views list the problems without links to disabled fields. */
  linked?: boolean;
};

/** "{n} problems must be fixed before this script can be approved." (E05-S02 Problems). */
const ProblemsAlert = React.forwardRef<HTMLDivElement, ProblemsAlertProps>(
  ({ issues, extra = [], isImage, linked = true }, ref) => {
    const { token } = theme.useToken();
    const total = issues.length + extra.length;
    if (total === 0) return null;
    return (
      <div ref={ref} tabIndex={-1}>
        <Alert
          type="warning"
          showIcon
          title={
            total === 1
              ? '1 problem must be fixed before this script can be approved.'
              : `${total} problems must be fixed before this script can be approved.`
          }
          description={
            <ul style={{ margin: 0, paddingInlineStart: token.paddingLG }}>
              {issues.map((issue, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: issues can repeat a path and code
                <li key={`${issue.path}-${issue.code}-${i}`}>
                  {linked ? (
                    <Typography.Link
                      href={`#${fieldDomId(issue.path)}`}
                      onClick={(event) => {
                        event.preventDefault();
                        focusField(issue.path, isImage);
                      }}
                    >
                      {issueText(issue, isImage)}
                    </Typography.Link>
                  ) : (
                    issueText(issue, isImage)
                  )}
                </li>
              ))}
              {extra.map((text, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: plain messages without identity
                <li key={`extra-${i}`}>{text}</li>
              ))}
            </ul>
          }
        />
      </div>
    );
  },
);

export default ProblemsAlert;
