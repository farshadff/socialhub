import { PictureOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { Space, Spin, Tag, Tooltip, Typography, theme } from 'antd';
import React from 'react';
import StatusTag from '@/components/StatusTag';
import useFormats from '@/pages/content/shared/useFormats';
import type { ContentItemSummary } from '@/services/socialhub/content';
import type { Format } from '@/services/socialhub/formats';

/** Width ÷ height of each format's preview (feed post 4:5, story and reel 9:16). */
const ASPECT: Record<Format, number> = {
  feed_post: 4 / 5,
  story: 9 / 16,
  reel: 9 / 16,
};

const FORMAT_ICON: Record<Format, React.ReactNode> = {
  reel: <VideoCameraOutlined />,
  story: <PictureOutlined />,
  feed_post: <PictureOutlined />,
};

/** Format tag with icon (a category tag: default colour, DESIGN-SYSTEM.md section 3). */
export const ItemFormatTag: React.FC<{ format: Format }> = ({ format }) => {
  const { formatLabel } = useFormats();
  return <Tag icon={FORMAT_ICON[format]}>{formatLabel(format)}</Tag>;
};

/** 48 px tall preview in the format's aspect ratio, or the format icon when there is none. */
export const Thumbnail: React.FC<{
  item: Pick<ContentItemSummary, 'thumbnail_url' | 'format' | 'title'>;
}> = ({ item }) => {
  const { token } = theme.useToken();
  const height = 48;
  const width = Math.round(height * (ASPECT[item.format] ?? 1));
  const frame: React.CSSProperties = {
    width,
    height,
    borderRadius: token.borderRadiusSM,
    background: token.colorFillTertiary,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    color: token.colorTextTertiary,
    flex: 'none',
  };
  return item.thumbnail_url ? (
    <div style={frame}>
      <img
        src={item.thumbnail_url}
        alt={`Preview of ${item.title}`}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </div>
  ) : (
    <div style={frame} aria-hidden>
      {FORMAT_ICON[item.format]}
    </div>
  );
};

/** Status tag plus a spinner and the job message while a job runs. */
export const ItemStatus: React.FC<{
  item: Pick<ContentItemSummary, 'status' | 'active_job'>;
  compact?: boolean;
}> = ({ item, compact }) => {
  const job = item.active_job;
  const running = job && (job.status === 'queued' || job.status === 'running');
  return (
    <Space size={6} wrap>
      <StatusTag kind="item" status={item.status} />
      {running ? (
        compact ? (
          <Tooltip title={job.message || 'Working…'}>
            <Spin size="small" aria-label={job.message || 'Working'} />
          </Tooltip>
        ) : (
          <Space size={4}>
            <Spin size="small" />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {job.message || 'Working…'}
            </Typography.Text>
          </Space>
        )
      ) : null}
    </Space>
  );
};

export const hasRunningJob = (
  items: Pick<ContentItemSummary, 'active_job'>[],
) =>
  items.some(
    (item) =>
      item.active_job &&
      (item.active_job.status === 'queued' ||
        item.active_job.status === 'running'),
  );
