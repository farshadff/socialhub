import { useQuery } from '@tanstack/react-query';
import { Alert, Space, Typography } from 'antd';
import React from 'react';
import DateTime from '@/components/DateTime';
import StatusTag from '@/components/StatusTag';
import { getAnalyticsSyncStatus } from '@/services/socialhub/analytics';
import { accountQueryKey } from '@/utils/accountRequest';

const SyncStatusLine: React.FC<{ accountId: number }> = ({ accountId }) => {
  const query = useQuery({
    queryKey: accountQueryKey(accountId, 'analytics-sync-status'),
    queryFn: getAnalyticsSyncStatus,
    refetchInterval: 60_000,
  });
  if (query.isPending) return <Typography.Text type="secondary">Checking analytics freshness…</Typography.Text>;
  if (query.error) return <Alert type="warning" showIcon title="Analytics sync status is unavailable." />;
  const status = query.data;
  if (!status) return null;
  return (
    <Space wrap>
      <Typography.Text type="secondary">Metrics last synced: <DateTime value={status.metrics_last_snapshot_at} empty="No metrics synced yet" /></Typography.Text>
      {status.metrics_overdue ? <><StatusTag kind="metrics" status="overdue" /><Typography.Text type="warning">{status.metrics_overdue} overdue checkpoint{status.metrics_overdue === 1 ? '' : 's'}</Typography.Text></> : null}
      {status.needs_manual_entry ? <><StatusTag kind="metrics" status="needs_manual_entry" /><Typography.Text type="warning">{status.needs_manual_entry} checkpoint{status.needs_manual_entry === 1 ? '' : 's'} need manual entry</Typography.Text></> : null}
      <Typography.Text type="secondary">Followers last recorded: {status.followers_last_snapshot_date ?? 'No snapshot yet'}{status.followers_overdue ? ' · overdue' : ''}</Typography.Text>
      {status.collector.last_error_code ? <Typography.Text type="danger">Last sync issue: {status.collector.last_error_code}</Typography.Text> : null}
    </Space>
  );
};

export default SyncStatusLine;
