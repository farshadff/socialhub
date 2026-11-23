import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '@ant-design/pro-components';
import { DatePicker, Empty, Space, Table, Typography, Button, Card, Alert } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import React, { useMemo, useState } from 'react';
import AccountGate from '@/components/AccountGate';
import DateTime from '@/components/DateTime';
import JobButton from '@/components/JobButton';
import PageError from '@/components/PageError';
import SyncStatusLine from '@/components/analytics/SyncStatusLine';
import ManualFollowerModal from '@/components/analytics/ManualFollowerModal';
import { Line as FollowerLine } from '@ant-design/plots';
import { useActiveJob } from '@/hooks/useJob';
import { getAccountAnalytics, getAnalyticsSyncStatus, refreshAnalytics, type AccountAnalyticsPoint } from '@/services/socialhub/analytics';
import { accountQueryKey, useCurrentAccount } from '@/utils/accountRequest';

dayjs.extend(utc);
dayjs.extend(timezone);

type FollowerRow = AccountAnalyticsPoint | { date: string; followers: null; following: null; media_count: null; follower_change: null; source: null; captured_at: null };

const FollowersPage: React.FC<{ accountId: number; timezoneName: string }> = ({ accountId, timezoneName }) => {
  const queryClient = useQueryClient();
  const today = dayjs().tz(timezoneName).startOf('day');
  const [from, setFrom] = useState(today.subtract(29, 'day').format('YYYY-MM-DD'));
  const [to, setTo] = useState(today.format('YYYY-MM-DD'));
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDate, setManualDate] = useState<string | null>(null);
  const range = { from, to };
  const query = useQuery({
    queryKey: accountQueryKey(accountId, 'analytics-account', range),
    queryFn: () => getAccountAnalytics(range),
  });
  const syncQuery = useQuery({ queryKey: accountQueryKey(accountId, 'analytics-sync-status'), queryFn: getAnalyticsSyncStatus });
  const activeJobQuery = useActiveJob({ account: accountId, kinds: ['analytics.refresh'], targetType: 'account' });
  const refreshViews = async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: accountQueryKey(accountId, 'analytics-account') }),
    queryClient.invalidateQueries({ queryKey: accountQueryKey(accountId, 'analytics-sync-status') }),
  ]);
  const data = query.data;
  const points = data?.points ?? [];
  const existing = manualDate ? points.find((point) => point.date === manualDate) ?? null : null;
  const rows = useMemo<FollowerRow[]>(() => {
    if (!data) return [];
    const byDate = new Map(data.points.map((point) => [point.date, point]));
    const result: FollowerRow[] = [];
    let date = dayjs(data.from);
    const end = dayjs(data.to);
    while (date.isBefore(end, 'day') || date.isSame(end, 'day')) {
      const key = date.format('YYYY-MM-DD');
      result.push(byDate.get(key) ?? { date: key, followers: null, following: null, media_count: null, follower_change: null, source: null, captured_at: null });
      date = date.add(1, 'day');
    }
    return result;
  }, [data]);
  const columns: ColumnsType<FollowerRow> = [
    { title: 'Date', dataIndex: 'date', render: (_, row) => <Typography.Text>{dayjs(row.date).format('D MMM YYYY')}</Typography.Text> },
    { title: 'Followers', dataIndex: 'followers', render: (_, row) => row.followers === null ? <Typography.Text type="secondary">No snapshot</Typography.Text> : new Intl.NumberFormat('en-US').format(row.followers) },
    { title: 'Change', dataIndex: 'follower_change', render: (_, row) => row.follower_change === null ? '—' : <Typography.Text type={row.follower_change < 0 ? 'danger' : row.follower_change > 0 ? 'success' : undefined}>{row.follower_change > 0 ? '+' : ''}{row.follower_change}</Typography.Text> },
    { title: 'Following', dataIndex: 'following', render: (value) => value ?? '—' },
    { title: 'Media', dataIndex: 'media_count', render: (value) => value ?? '—' },
    { title: 'Source', dataIndex: 'source', render: (value) => value === 'manual' ? 'Entered by hand' : value === 'provider' ? 'Instagram' : '—' },
    { title: 'Captured', dataIndex: 'captured_at', render: (value) => value ? <DateTime value={value} /> : '—' },
    { title: '', key: 'action', render: (_, row) => <Button type="link" size="small" onClick={() => { setManualDate(row.date); setManualOpen(true); }}>Enter or replace</Button> },
  ];

  return (
    <PageContainer title="Account followers" content="Daily follower counts and change for this account.">
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
          <SyncStatusLine accountId={accountId} />
          <JobButton
            type="primary"
            start={() => refreshAnalytics()}
            activeJob={activeJobQuery.data}
            kinds={['analytics.refresh']}
            disabled={syncQuery.data?.insights_source === 'manual'}
            disabledReason="This account records follower counts by hand."
            onStarted={() => { void activeJobQuery.refetch(); }}
            onDone={() => { void refreshViews(); }}
            onFailed={() => { void refreshViews(); }}
            successMessage="Analytics refreshed"
          >Refresh now</JobButton>
        </Space>
        <Space wrap>
          <DatePicker.RangePicker
            value={[dayjs(from), dayjs(to)]}
            format="D MMM YYYY"
            onChange={(values) => {
              if (values?.[0] && values[1]) {
                setFrom(values[0].format('YYYY-MM-DD'));
                setTo(values[1].format('YYYY-MM-DD'));
              }
            }}
            disabledDate={(date) => date.isAfter(dayjs().tz(timezoneName), 'day')}
          />
          <Button onClick={() => { setManualDate(dayjs().tz(timezoneName).format('YYYY-MM-DD')); setManualOpen(true); }}>Enter follower count</Button>
        </Space>
        {data?.insights_source === 'manual' ? <Alert type="info" showIcon title="This account records follower counts by hand." /> : null}
        {query.error ? <PageError error={query.error} onRetry={() => { void query.refetch(); }} /> : null}
        {data ? <Card title="Follower change">
          <Space wrap size={24} style={{ marginBottom: 16 }}>
            <div><Typography.Text type="secondary">Current</Typography.Text><br /><Typography.Title level={3} style={{ margin: 0 }}>{data.current ? new Intl.NumberFormat('en-US').format(data.current.followers) : '—'}</Typography.Title><Typography.Text type="secondary">{data.current?.date ?? 'No follower snapshot yet'}</Typography.Text></div>
            <div><Typography.Text type="secondary">Change in selected period</Typography.Text><br /><Typography.Title level={3} style={{ margin: 0 }} type={data.period && data.period.change < 0 ? 'danger' : undefined}>{data.period ? `${data.period.change > 0 ? '+' : ''}${new Intl.NumberFormat('en-US').format(data.period.change)}` : '—'}</Typography.Title><Typography.Text type="secondary">{data.period ? `${data.period.start.date} to ${data.period.end.date}${data.period.exact ? '' : ' · closest available snapshots'}` : 'At least two snapshots are needed'}</Typography.Text></div>
            <div><Typography.Text type="secondary">Missing days</Typography.Text><br /><Typography.Title level={3} style={{ margin: 0 }}>{data.missing_dates.length}</Typography.Title></div>
          </Space>
          {points.length >= 2 ? <FollowerLine data={rows} xField="date" yField="followers" connectNulls={false} axis={{ x: { title: 'Date' }, y: { title: 'Followers' } }} height={300} /> : <Empty description="The follower curve appears after two daily snapshots." />}
        </Card> : null}
        <Card title="Daily snapshots">
          <Table<FollowerRow> rowKey="date" size="small" dataSource={rows} columns={columns} loading={query.isPending || query.isFetching} pagination={{ pageSize: 20, showSizeChanger: false }} locale={{ emptyText: <Empty description="No follower snapshots for this period." /> }} scroll={{ x: 850 }} />
        </Card>
      </Space>
      <ManualFollowerModal open={manualOpen} timezoneName={timezoneName} existing={existing} onCancel={() => setManualOpen(false)} onSaved={() => { setManualOpen(false); void refreshViews(); }} />
    </PageContainer>
  );
};

const AnalyticsAccountPage: React.FC = () => {
  const { account, accountId } = useCurrentAccount();
  return <AccountGate title="Account followers">{account && accountId !== null ? <FollowersPage key={accountId} accountId={accountId} timezoneName={account.timezone} /> : null}</AccountGate>;
};

export default AnalyticsAccountPage;
