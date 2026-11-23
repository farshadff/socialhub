import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '@ant-design/pro-components';
import { history, Link } from '@umijs/max';
import { DatePicker, Empty, Select, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import React, { useMemo, useState } from 'react';
import AccountGate from '@/components/AccountGate';
import DateTime from '@/components/DateTime';
import JobButton from '@/components/JobButton';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import MetricCell from '@/components/analytics/MetricCell';
import SyncStatusLine from '@/components/analytics/SyncStatusLine';
import { useActiveJob } from '@/hooks/useJob';
import { Thumbnail } from '@/pages/content/parts';
import { listAnalyticsPosts, getAnalyticsSyncStatus, refreshAnalytics, type AnalyticsPostRow, type MetricsStatus } from '@/services/socialhub/analytics';
import type { Format } from '@/services/socialhub/formats';
import { accountQueryKey, useCurrentAccount } from '@/utils/accountRequest';
import type { EvaluationVerdict } from '@/services/socialhub/evaluations';

const FORMAT_OPTIONS: { label: string; value: Format }[] = [
  { label: 'Reel', value: 'reel' }, { label: 'Story', value: 'story' }, { label: 'Feed post', value: 'feed_post' },
];
const STATUS_OPTIONS: { label: string; value: MetricsStatus }[] = [
  { label: 'Collecting', value: 'collecting' }, { label: 'Overdue', value: 'overdue' }, { label: 'Needs manual entry', value: 'needs_manual_entry' }, { label: 'Complete', value: 'complete' }, { label: 'Incomplete', value: 'incomplete' },
];
const VERDICT_OPTIONS: { label: string; value: EvaluationVerdict }[] = [
  { label: 'Outperforming', value: 'outperforming' }, { label: 'On par', value: 'on_par' },
  { label: 'Underperforming', value: 'underperforming' }, { label: 'Not enough data', value: 'insufficient_data' },
];

const AnalyticsPosts: React.FC<{ accountId: number }> = ({ accountId }) => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [formats, setFormats] = useState<Format[]>([]);
  const [statuses, setStatuses] = useState<MetricsStatus[]>([]);
  const [verdicts, setVerdicts] = useState<EvaluationVerdict[]>([]);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const pageSize = 20;
  const params = useMemo(() => ({
    format: formats.length ? formats : undefined,
    metrics_status: statuses.length ? statuses : undefined,
    verdict: verdicts.length ? verdicts : undefined,
    published_after: range?.[0].format('YYYY-MM-DD'),
    published_before: range?.[1].format('YYYY-MM-DD'),
    ordering: '-published_at' as const,
    page,
    page_size: pageSize,
  }), [formats, statuses, verdicts, range, page]);
  const query = useQuery({
    queryKey: accountQueryKey(accountId, 'analytics-posts', params),
    queryFn: () => listAnalyticsPosts(params),
  });
  const syncQuery = useQuery({ queryKey: accountQueryKey(accountId, 'analytics-sync-status'), queryFn: getAnalyticsSyncStatus });
  const activeJobQuery = useActiveJob({ account: accountId, kinds: ['analytics.refresh'], targetType: 'account' });
  const refreshViews = async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: accountQueryKey(accountId, 'analytics-posts') }),
    queryClient.invalidateQueries({ queryKey: accountQueryKey(accountId, 'analytics-sync-status') }),
  ]);

  const columns: ColumnsType<AnalyticsPostRow> = [
    { title: 'Post', key: 'post', render: (_, row) => <Space><Thumbnail item={{ title: row.content_item.title, format: row.format, thumbnail_url: row.thumbnail_url }} /><div><Link to={`/analytics/posts/${row.publication}`}><Typography.Text strong>{row.content_item.title}</Typography.Text></Link><br /><Typography.Text type="secondary">{row.format.replace('_', ' ')}</Typography.Text></div></Space> },
    { title: 'Published', dataIndex: 'published_at', render: (_, row) => <DateTime value={row.published_at} /> },
    { title: 'Age', dataIndex: 'age_minutes', render: (_, row) => `${Math.floor(row.age_minutes / 60)} h` },
    { title: 'Reach', key: 'reach', render: (_, row) => <MetricCell metric="reach" value={row.latest?.reach} unavailable={row.latest?.unavailable} source={row.latest?.source} /> },
    { title: 'Views', key: 'views', render: (_, row) => <MetricCell metric="views" value={row.latest?.views} unavailable={row.latest?.unavailable} source={row.latest?.source} /> },
    { title: 'Saves', key: 'saves', render: (_, row) => <MetricCell metric="saves" value={row.latest?.saves} unavailable={row.latest?.unavailable} source={row.latest?.source} /> },
    { title: 'Shares', key: 'shares', render: (_, row) => <MetricCell metric="shares" value={row.latest?.shares} unavailable={row.latest?.unavailable} source={row.latest?.source} /> },
    { title: 'Verdict', key: 'verdict', render: (_, row) => row.latest_evaluation ? <Space direction="vertical" size={0}><StatusTag kind="verdict" status={row.latest_evaluation.verdict} /><Typography.Text type="secondary">{row.latest_evaluation.checkpoint}{row.latest_evaluation.is_final ? '' : ' · so far'}</Typography.Text></Space> : '—' },
    { title: 'Vs baseline', key: 'baseline', render: (_, row) => row.latest_evaluation?.baseline_ratio ? `${Number(row.latest_evaluation.baseline_ratio).toFixed(2)}×` : '—' },
    { title: 'Goal', key: 'goal', render: (_, row) => row.latest_evaluation ? <StatusTag kind="goal" status={row.latest_evaluation.goal_result === 'missed' && !row.latest_evaluation.is_final ? 'missed_pending' : row.latest_evaluation.goal_result} /> : '—' },
    { title: 'Latest reading', key: 'latest', render: (_, row) => row.latest ? <Space direction="vertical" size={0}><Typography.Text>{row.latest.checkpoint}</Typography.Text><DateTime value={row.latest.captured_at} format="relative" /></Space> : <Typography.Text type="secondary">No readings</Typography.Text> },
    { title: 'Status', dataIndex: 'metrics_status', render: (_, row) => <StatusTag kind="metrics" status={row.metrics_status} /> },
  ];

  return (
    <PageContainer title="Post analytics" content="Reach, views, saves and shares for published content.">
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
          <SyncStatusLine accountId={accountId} />
          <JobButton
            type="primary"
            start={() => refreshAnalytics()}
            activeJob={activeJobQuery.data}
            kinds={['analytics.refresh']}
            disabled={syncQuery.data?.insights_source === 'manual'}
            disabledReason="This account records metrics by hand."
            onStarted={() => { void activeJobQuery.refetch(); }}
            onDone={() => { void refreshViews(); }}
            onFailed={() => { void refreshViews(); }}
            successMessage="Analytics refreshed"
          >Refresh metrics</JobButton>
        </Space>
        <Space wrap>
          <DatePicker.RangePicker value={range} onChange={(values) => { setRange(values?.[0] && values[1] ? [values[0], values[1]] : null); setPage(1); }} placeholder={['Published from', 'Published to']} />
          <Select mode="multiple" value={formats} options={FORMAT_OPTIONS} onChange={(value: Format[]) => { setFormats(value); setPage(1); }} placeholder="All formats" style={{ minWidth: 200 }} maxTagCount="responsive" />
          <Select mode="multiple" value={statuses} options={STATUS_OPTIONS} onChange={(value: MetricsStatus[]) => { setStatuses(value); setPage(1); }} placeholder="All metric statuses" style={{ minWidth: 220 }} maxTagCount="responsive" />
          <Select mode="multiple" value={verdicts} options={VERDICT_OPTIONS} onChange={(value: EvaluationVerdict[]) => { setVerdicts(value); setPage(1); }} placeholder="All verdicts" style={{ minWidth: 220 }} maxTagCount="responsive" />
        </Space>
        {query.error ? <PageError error={query.error} onRetry={() => { void query.refetch(); }} /> : null}
        <Table<AnalyticsPostRow>
          rowKey="publication"
          columns={columns}
          dataSource={query.data?.results ?? []}
          loading={query.isPending || query.isFetching}
          onRow={(row) => ({ onClick: () => history.push(`/analytics/posts/${row.publication}`) })}
          locale={{ emptyText: <Empty description="Published posts will appear here as soon as they go live." /> }}
          pagination={{ current: page, pageSize, total: query.data?.count ?? 0, showSizeChanger: false, onChange: setPage, showTotal: (total) => `${total} posts` }}
          scroll={{ x: 1100 }}
        />
      </Space>
    </PageContainer>
  );
};

const PostsPage: React.FC = () => {
  const { accountId } = useCurrentAccount();
  return <AccountGate title="Post analytics">{accountId !== null ? <AnalyticsPosts key={accountId} accountId={accountId} /> : null}</AccountGate>;
};

export default PostsPage;
