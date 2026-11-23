import { useQuery } from '@tanstack/react-query';
import { PageContainer } from '@ant-design/pro-components';
import { history, Link } from '@umijs/max';
import { Button, Empty, Segmented, Select, Space, Table, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import React, { useState } from 'react';
import AccountGate from '@/components/AccountGate';
import DateTime from '@/components/DateTime';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import OutcomeTag from '@/components/quality/OutcomeTag';
import { Thumbnail } from '@/pages/content/parts';
import { listReviewTasks, type ReviewReason, type ReviewTaskRow } from '@/services/socialhub/quality';
import { accountQueryKey, useCurrentAccount } from '@/utils/accountRequest';

const REASONS: { label: string; value: ReviewReason }[] = [
  { label: 'Checks escalated', value: 'qc_escalated' },
  { label: 'Revision limit reached', value: 'max_revisions' },
  { label: 'Publishing failed', value: 'publish_failed' },
  { label: 'No free time', value: 'no_slot' },
  { label: 'Flagged by a person', value: 'manual' },
];

const QUEUE_EMPTY = 'Nothing needs review. Items that pass their checks schedule themselves.';
const RESOLVED_EMPTY = 'No resolved tasks yet.';

const ReviewQueue: React.FC<{ accountId: number }> = ({ accountId }) => {
  const [status, setStatus] = useState<'open' | 'resolved'>('open');
  const [reason, setReason] = useState<ReviewReason[]>([]);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const query = useQuery({
    queryKey: accountQueryKey(accountId, 'review-tasks', { status, reason, page }),
    queryFn: () => listReviewTasks({ account: accountId, status, reason: reason.length ? reason : undefined, page, page_size: pageSize, ordering: status === 'open' ? 'created_at' : '-created_at' }),
  });

  const columns: ColumnsType<ReviewTaskRow> = [
    {
      title: '',
      key: 'preview',
      width: 68,
      render: (_, row) => <Thumbnail item={{ thumbnail_url: row.item.thumbnail_url ?? null, format: row.item.format, title: row.item.title }} />,
    },
    {
      title: 'Item',
      key: 'item',
      render: (_, row) => <Space direction="vertical" size={0}><Link to={`/review/${row.id}`}><Typography.Text strong>{row.item.title}</Typography.Text></Link><Typography.Text type="secondary">{row.item.format.replace('_', ' ')}</Typography.Text></Space>,
    },
    { title: 'Reason', dataIndex: 'reason', render: (_, row) => <StatusTag kind="review_reason" status={row.reason} /> },
    {
      title: 'Summary',
      dataIndex: 'detail',
      render: (_, row) => {
        const summary = row.reason === 'publish_failed' ? `${row.publication?.attempt_count ?? 0} publish attempts · ${row.detail}` : row.detail;
        return <Tooltip title={summary}><div style={{ maxWidth: 380 }}><Typography.Paragraph ellipsis={{ rows: 2 }} style={{ margin: 0 }}>{row.qc_run ? <><OutcomeTag outcome={row.qc_run.outcome} />{' '}{row.qc_run.summary || summary}</> : summary}</Typography.Paragraph></div></Tooltip>;
      },
    },
    {
      title: 'Slot',
      key: 'slot',
      render: (_, row) => {
        const value = row.item.slot?.scheduled_at;
        return value ? <Typography.Text type={dayjs(value).isBefore(dayjs()) ? 'danger' : undefined}><DateTime value={value} /></Typography.Text> : 'No slot';
      },
    },
    { title: 'Created', dataIndex: 'created_at', render: (_, row) => <DateTime value={row.created_at} /> },
    {
      title: 'Age', key: 'age', render: (_, row) => {
        const hours = dayjs().diff(dayjs(row.created_at), 'hour');
        const age = hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
        return <Typography.Text type={hours >= 24 ? 'warning' : 'secondary'}>{age}</Typography.Text>;
      },
    },
    ...(status === 'resolved' ? [
      { title: 'Decision', dataIndex: 'decision', render: (_: unknown, row: ReviewTaskRow) => row.decision ? <StatusTag kind="review_decision" status={row.decision} /> : '—' },
      { title: 'Resolved by', dataIndex: ['resolved_by', 'name'], render: (_: unknown, row: ReviewTaskRow) => row.resolved_by?.name ?? '—' },
      { title: 'Resolved', dataIndex: 'resolved_at', render: (_: unknown, row: ReviewTaskRow) => <DateTime value={row.resolved_at} /> },
    ] as ColumnsType<ReviewTaskRow> : []),
  ];

  return (
    <PageContainer title="Review" content="Items the system could not decide on its own.">
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space wrap>
          <Segmented
            value={status}
            options={[{ label: 'Open', value: 'open' }, { label: 'Resolved', value: 'resolved' }]}
            onChange={(value) => { setStatus(value as 'open' | 'resolved'); setPage(1); }}
          />
          <Typography.Text type="secondary">Reason</Typography.Text>
          <Select
            aria-label="Filter by reason"
            mode="multiple"
            value={reason}
            options={REASONS}
            onChange={(value: ReviewReason[]) => { setReason(value); setPage(1); }}
            style={{ minWidth: 240, maxWidth: 420 }}
            placeholder="All reasons"
            maxTagCount="responsive"
          />
          {reason.length ? <Button type="link" onClick={() => setReason([])}>Clear filter</Button> : null}
        </Space>
        {query.isError ? <PageError error={query.error} onRetry={() => { void query.refetch(); }} /> : null}
        <Table
          rowKey="id"
          columns={columns}
          dataSource={query.data?.results ?? []}
          loading={query.isPending || query.isFetching}
          onRow={(row) => ({ onClick: () => { history.push(`/review/${row.id}`); } })}
          rowClassName="clickable-row"
          locale={{ emptyText: <Empty description={status === 'open' ? QUEUE_EMPTY : RESOLVED_EMPTY} /> }}
          pagination={{ current: page, pageSize, total: query.data?.count ?? 0, showSizeChanger: false, onChange: setPage, showTotal: (total) => `${total} tasks` }}
          scroll={{ x: 1000 }}
        />
      </Space>
    </PageContainer>
  );
};

const ReviewPage: React.FC = () => {
  const { accountId } = useCurrentAccount();
  return <AccountGate title="Review">{accountId !== null ? <ReviewQueue key={accountId} accountId={accountId} /> : null}</AccountGate>;
};

export default ReviewPage;
