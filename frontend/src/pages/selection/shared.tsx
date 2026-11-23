import {
  FileTextOutlined,
  GlobalOutlined,
  PictureOutlined,
  ReloadOutlined,
  RiseOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import type { ActionType } from '@ant-design/pro-components';
import { Tag } from 'antd';
import React, { useEffect, useRef } from 'react';
import type { Account } from '@/services/socialhub/accounts';
import type { Format } from '@/services/socialhub/formats';
import type { PlanSummary } from '@/services/socialhub/plans';
import type { CandidateKind } from '@/services/socialhub/selection';
import { FORMAT_LABEL, KIND_LABEL, type TabKey } from './logic';

export type SelectionTabProps = {
  account: Account;
  /** The chosen plan; null when the account has no draft or active plan. */
  plan: PlanSummary | null;
  /** Bumped after ranking or confirming, so every tab reloads. */
  refreshKey: number;
  /** A ranking job is running for the plan. */
  rankRunning: boolean;
  /** Tells the page that data changed (header summary and other tabs reload). */
  onChanged: () => void;
  goToTab: (tab: TabKey) => void;
};

/** Reloads a ProTable whenever `key` changes, skipping the first render. */
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

export function toPageParams(params: { current?: number; pageSize?: number }) {
  return { page: params.current ?? 1, page_size: params.pageSize ?? 20 };
}

const KIND_ICON: Record<CandidateKind, React.ReactNode> = {
  trend: <RiseOutlined />,
  feed_item: <FileTextOutlined />,
  repurpose: <ReloadOutlined />,
};

/** Candidate kind: a default tag with an icon, no colour (DESIGN-SYSTEM.md section 3). */
export const KindTag: React.FC<{ kind: CandidateKind }> = ({ kind }) => (
  <Tag icon={KIND_ICON[kind]}>{KIND_LABEL[kind]}</Tag>
);

const FORMAT_ICON: Record<Format, React.ReactNode> = {
  reel: <VideoCameraOutlined />,
  story: <PictureOutlined />,
  feed_post: <PictureOutlined />,
};

export const FormatTag: React.FC<{ format: Format }> = ({ format }) => (
  <Tag icon={FORMAT_ICON[format]}>{FORMAT_LABEL[format] ?? format}</Tag>
);

/** External link that opens in a new tab. */
export const ExternalLink: React.FC<{
  href: string;
  children: React.ReactNode;
}> = ({ href, children }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {children} <GlobalOutlined aria-hidden style={{ fontSize: 12 }} />
  </a>
);
