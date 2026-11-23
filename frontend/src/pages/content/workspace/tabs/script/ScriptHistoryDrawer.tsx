import { contentFontFamily } from '@root/config/theme';
import { useQuery } from '@tanstack/react-query';
import { Button, Drawer, List, Skeleton, Space, Tag, Typography, theme } from 'antd';
import React from 'react';
import ContentText from '@/components/ContentText';
import DateTime from '@/components/DateTime';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import { listScriptVersions, type ScriptVersionEntry } from '@/services/socialhub/scripts';
import { useAccountId } from '@/utils/accountRequest';
import { useContentLang } from './fields';
import { scriptVersionsKey } from './useScriptEditor';

export function originLabel(entry: Pick<ScriptVersionEntry, 'origin' | 'source'>): string {
  if (entry.origin === 'human') return 'Edited';
  if (entry.source === 'qc_revise') return 'AI · revise loop';
  if (entry.source === 'autopilot') return 'AI · autopilot';
  return 'AI';
}

export type ScriptHistoryDrawerProps = {
  open: boolean;
  onClose: () => void;
  itemId: number;
  isImage: boolean;
  /** Opens a version in the editor area, read-only unless it is the latest. */
  onSelect: (entry: ScriptVersionEntry) => void;
};

/** "Script history": every version, newest first (E05-S03 History drawer). */
const ScriptHistoryDrawer: React.FC<ScriptHistoryDrawerProps> = ({
  open,
  onClose,
  itemId,
  isImage,
  onSelect,
}) => {
  const { token } = theme.useToken();
  const accountId = useAccountId();
  const lang = useContentLang();
  const query = useQuery({
    queryKey: scriptVersionsKey(accountId, itemId),
    queryFn: () => listScriptVersions(itemId),
    enabled: open,
  });

  let body: React.ReactNode;
  if (query.isPending) {
    body = (
      <Space orientation="vertical" size={token.marginLG} style={{ width: '100%' }}>
        {[0, 1, 2].map((n) => (
          <Skeleton key={n} active title paragraph={{ rows: 2 }} />
        ))}
      </Space>
    );
  } else if (query.isError) {
    body = <PageError error={query.error} onRetry={() => query.refetch()} />;
  } else {
    body = (
      <List<ScriptVersionEntry>
        itemLayout="vertical"
        dataSource={query.data.results}
        renderItem={(entry) => {
          const summary = isImage
            ? '1 frame'
            : `${entry.summary.frame_count} ${entry.summary.frame_count === 1 ? 'frame' : 'frames'} · ${entry.summary.duration_seconds} s`;
          return (
            <List.Item
              key={entry.version}
              onClick={() => onSelect(entry)}
              style={{ cursor: 'pointer' }}
            >
              <Space orientation="vertical" size={token.marginXXS} style={{ width: '100%' }}>
                <Space size={token.marginXS} wrap>
                  <Button
                    type="link"
                    style={{ padding: 0, height: 'auto', fontWeight: token.fontWeightStrong }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(entry);
                    }}
                  >
                    {`Version ${entry.version}`}
                  </Button>
                  <StatusTag kind="script" status={entry.status} />
                  <Tag>{originLabel(entry)}</Tag>
                  {entry.is_latest ? <Tag>Current</Tag> : null}
                  {entry.status === 'approved' ? <Tag>In production</Tag> : null}
                </Space>
                <Typography.Text type="secondary">
                  {entry.created_by ? `${entry.created_by.name} · ` : ''}
                  <DateTime value={entry.created_at} />
                  {` · ${summary}`}
                </Typography.Text>
                {entry.summary.hook ? (
                  <ContentText as="div">{entry.summary.hook}</ContentText>
                ) : null}
                {entry.feedback ? (
                  <Typography.Paragraph
                    type="secondary"
                    italic
                    dir="auto"
                    lang={lang}
                    style={{ marginBottom: 0, fontFamily: contentFontFamily[lang] }}
                    ellipsis={{ rows: 2, expandable: true, symbol: 'more' }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {entry.feedback}
                  </Typography.Paragraph>
                ) : null}
              </Space>
            </List.Item>
          );
        }}
      />
    );
  }

  return (
    <Drawer title="Script history" size={480} open={open} onClose={onClose} destroyOnHidden>
      {body}
    </Drawer>
  );
};

export default ScriptHistoryDrawer;
