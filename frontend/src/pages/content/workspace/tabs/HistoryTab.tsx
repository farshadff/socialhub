import {
  AuditOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  EditOutlined,
  MessageOutlined,
  PlayCircleOutlined,
  SendOutlined,
  SwapRightOutlined,
} from '@ant-design/icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  Segmented,
  Skeleton,
  Space,
  Timeline,
  Typography,
  theme,
} from 'antd';
import React, { useState } from 'react';
import DateTime from '@/components/DateTime';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import {
  type ContentEvent,
  type ContentItemDetail,
  type EventType,
  listContentEvents,
} from '@/services/socialhub/content';
import { jobErrorText } from '@/utils/errorText';
import { HISTORY_FILTER_TYPES, type HistoryFilter } from '../../logic';

const PAGE_SIZE = 50;

const ICON: Record<EventType, React.ReactNode> = {
  status_changed: <SwapRightOutlined />,
  job_started: <PlayCircleOutlined />,
  job_failed: <CloseCircleOutlined />,
  edited: <EditOutlined />,
  qc_result: <CheckCircleOutlined />,
  review_decision: <AuditOutlined />,
  publish_attempt: <SendOutlined />,
  note: <MessageOutlined />,
};

const TYPE_LABEL: Record<EventType, string> = {
  status_changed: 'Status change',
  job_started: 'Job started',
  job_failed: 'Job failed',
  edited: 'Edit',
  qc_result: 'Check',
  review_decision: 'Review',
  publish_attempt: 'Publish attempt',
  note: 'Note',
};

/** One timeline entry: message, status change, actor and time (E03-S04 History tab). */
export const EventEntry: React.FC<{ event: ContentEvent }> = ({ event }) => {
  const failed = event.type === 'job_failed';
  const errorCode: string | undefined = event.data?.error_code;
  return (
    <Space orientation="vertical" size={2}>
      {event.type === 'status_changed' && event.to_status ? (
        <Space size={4} wrap>
          {event.from_status ? (
            <>
              <StatusTag kind="item" status={event.from_status} />
              <SwapRightOutlined aria-label="to" />
            </>
          ) : null}
          <StatusTag kind="item" status={event.to_status} />
        </Space>
      ) : null}
      <Typography.Text type={failed ? 'danger' : undefined}>
        {event.message || TYPE_LABEL[event.type] || event.type}
      </Typography.Text>
      {failed && errorCode ? (
        <Typography.Text type="danger" style={{ fontSize: 12 }}>
          {jobErrorText({ error_code: errorCode })} ({errorCode})
        </Typography.Text>
      ) : null}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {event.actor?.name ?? 'System'} · <DateTime value={event.created_at} />
      </Typography.Text>
    </Space>
  );
};

/** History tab: the item's events, newest first (E03-S04). */
const HistoryTab: React.FC<{
  item: ContentItemDetail;
  reload?: () => void;
}> = ({ item }) => {
  const { token } = theme.useToken();
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const query = useInfiniteQuery({
    queryKey: [
      item.account,
      'content-events',
      item.id,
      filter,
      item.updated_at,
    ],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      listContentEvents(item.id, {
        type: HISTORY_FILTER_TYPES[filter],
        page: pageParam,
        page_size: PAGE_SIZE,
      }),
    getNextPageParam: (last, pages) =>
      last.next ? pages.length + 1 : undefined,
  });

  let body: React.ReactNode;
  if (query.error) {
    body = <PageError error={query.error} onRetry={() => query.refetch()} />;
  } else if (query.isLoading) {
    body = <Skeleton active />;
  } else {
    const events = query.data?.pages.flatMap((page) => page.results) ?? [];
    body = events.length ? (
      <Timeline
        items={events.map((event) => ({
          key: event.id,
          dot: ICON[event.type] ?? <MessageOutlined />,
          color: event.type === 'job_failed' ? token.colorError : undefined,
          children: <EventEntry event={event} />,
        }))}
      />
    ) : (
      <Typography.Text type="secondary">
        No events of this kind.
      </Typography.Text>
    );
  }

  return (
    <Card size="small">
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        <Segmented<HistoryFilter>
          aria-label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'status', label: 'Status changes' },
            { value: 'jobs', label: 'Jobs' },
            { value: 'edits', label: 'Edits' },
          ]}
        />
        {body}
        {query.hasNextPage ? (
          <Button
            onClick={() => query.fetchNextPage()}
            loading={query.isFetchingNextPage}
          >
            Load more
          </Button>
        ) : null}
      </Space>
    </Card>
  );
};

export default HistoryTab;
