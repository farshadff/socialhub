import {
  EditOutlined,
  GlobalOutlined,
  SearchOutlined,
  WifiOutlined,
} from '@ant-design/icons';
import type { ActionType } from '@ant-design/pro-components';
import { Button, Tag, Tooltip } from 'antd';
import React, { useEffect, useRef } from 'react';
import StatusTag from '@/components/StatusTag';
import type { Account } from '@/services/socialhub/accounts';
import type { PlanSummary } from '@/services/socialhub/plans';
import type { Format, SignalKind } from '@/services/socialhub/research';
import { FORMAT_LABEL, KIND_LABEL, sourceStatusText } from './constants';

export type TabProps = {
  account: Account;
  refreshKey: number;
  readOnly: boolean;
  runActive: boolean;
  plans: PlanSummary[];
  onOpenTopic: (id: number) => void;
};

/** Reloads a ProTable whenever the shared refresh key changes (after a research run). */
export function useReloadOnChange(
  actionRef: React.MutableRefObject<ActionType | undefined>,
  key: unknown,
) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    actionRef.current?.reload();
  }, [key]);
}

const KIND_ICON: Record<SignalKind, React.ReactNode> = {
  web_search: <SearchOutlined />,
  rss: <WifiOutlined />,
  manual: <EditOutlined />,
};

export const KindTag: React.FC<{ kind: SignalKind }> = ({ kind }) => (
  <Tag icon={KIND_ICON[kind]}>{KIND_LABEL[kind]}</Tag>
);

export const FormatTags: React.FC<{ formats: Format[] }> = ({ formats }) => (
  <>
    {formats.map((format) => (
      <Tag key={format}>{FORMAT_LABEL[format]}</Tag>
    ))}
  </>
);

/** Last result of a source, with the failure reason in a tooltip. */
export const SourceResultTag: React.FC<{ status: string | null }> = ({
  status,
}) => {
  if (!status) return <span>—</span>;
  const reason = sourceStatusText(status);
  const tag = <StatusTag kind="research_source" status={status} />;
  return reason ? (
    <Tooltip title={reason}>
      <Button
        type="text"
        size="small"
        aria-label={`Failed: ${reason}`}
        style={{ padding: 0, height: 'auto' }}
      >
        {tag}
      </Button>
    </Tooltip>
  ) : (
    tag
  );
};

/** External link that opens in a new tab. */
export const ExternalLink: React.FC<{
  href: string;
  children: React.ReactNode;
}> = ({ href, children }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {children} <GlobalOutlined aria-hidden style={{ fontSize: 12 }} />
  </a>
);

export function toPageParams(params: { current?: number; pageSize?: number }) {
  return { page: params.current ?? 1, page_size: params.pageSize ?? 20 };
}
