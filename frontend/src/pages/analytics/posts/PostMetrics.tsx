import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@umijs/max';
import { Alert, Button, Card, Descriptions, Empty, Space, Skeleton, Tag, Typography } from 'antd';
import React, { useState } from 'react';
import ContentText from '@/components/ContentText';
import DateTime from '@/components/DateTime';
import EvaluationCard from '@/components/EvaluationCard';
import JobButton from '@/components/JobButton';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import CheckpointTable from '@/components/analytics/CheckpointTable';
import ManualSnapshotModal from '@/components/analytics/ManualSnapshotModal';
import MetricCurve from '@/components/analytics/MetricCurve';
import SyncStatusLine from '@/components/analytics/SyncStatusLine';
import { getAnalyticsPost, refreshAnalytics, type MetricSnapshot } from '@/services/socialhub/analytics';
import { useActiveJob } from '@/hooks/useJob';
import { accountQueryKey, useCurrentAccount } from '@/utils/accountRequest';

const PostMetrics: React.FC<{ publicationId: number; accountId: number }> = ({ publicationId, accountId }) => {
  const { account } = useCurrentAccount();
  const queryClient = useQueryClient();
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCheckpoint, setManualCheckpoint] = useState<string | undefined>();
  const [manualExisting, setManualExisting] = useState<MetricSnapshot | null>(null);
  const query = useQuery({
    queryKey: accountQueryKey(accountId, 'analytics-post', publicationId),
    queryFn: () => getAnalyticsPost(publicationId),
  });
  const activeJobQuery = useActiveJob({ account: accountId, kinds: ['analytics.refresh'], targetType: 'publication', targetId: String(publicationId) });
  const refreshEnabled = query.data?.insights_source !== 'manual';
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: accountQueryKey(accountId, 'analytics-post', publicationId) }),
    queryClient.invalidateQueries({ queryKey: accountQueryKey(accountId, 'analytics-posts') }),
    queryClient.invalidateQueries({ queryKey: accountQueryKey(accountId, 'analytics-sync-status') }),
  ]);
  const enterMetrics = (checkpoint?: string, existing?: MetricSnapshot | null) => {
    setManualCheckpoint(checkpoint);
    setManualExisting(existing ?? null);
    setManualOpen(true);
  };

  if (query.isPending) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (query.error) return <PageError error={query.error} onRetry={() => { void query.refetch(); }} />;
  const post = query.data;
  if (!post) return null;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title={<Space wrap><ContentText>{post.content_item.title}</ContentText><TagFormat format={post.format} /><StatusTag kind="metrics" status={post.metrics_status} /></Space>}
        extra={<Space wrap>
          <Button onClick={() => enterMetrics()}>Enter metrics</Button>
          <JobButton
            type="primary"
            start={() => refreshAnalytics(publicationId)}
            activeJob={activeJobQuery.data}
            kinds={['analytics.refresh']}
            disabled={!refreshEnabled}
            disabledReason="This account records metrics by hand."
            onDone={() => { void refresh(); }}
            onFailed={() => { void refresh(); }}
            onStarted={() => { void activeJobQuery.refetch(); }}
            successMessage="Metrics refreshed"
          >Refresh metrics</JobButton>
        </Space>}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }} items={[
            { key: 'published', label: 'Published', children: <DateTime value={post.published_at} /> },
            { key: 'via', label: 'Published via', children: post.published_via ?? '—' },
            { key: 'source', label: 'Metrics source', children: post.insights_source === 'manual' ? 'Entered by hand' : 'Instagram' },
            { key: 'fresh', label: 'Last synced', children: <DateTime value={post.last_synced_at} empty="No readings yet" /> },
          ]} />
          {post.permalink ? <a href={post.permalink} target="_blank" rel="noreferrer">View on Instagram</a> : null}
          {post.insights_source === 'manual' ? <Alert type="info" showIcon title="This account uses manual metrics. Enter a reading at each checkpoint." /> : null}
        </Space>
      </Card>
      <SyncStatusLine accountId={accountId} />
      <Card title="Metric curve">
        <MetricCurve checkpoints={post.checkpoints} adhoc={post.adhoc} metrics={post.applicable_metrics} />
      </Card>
      <EvaluationCard
        accountId={accountId}
        publicationId={publicationId}
        title={post.content_item.title}
        format={post.format}
        checkpoints={post.checkpoints}
        onEnterManual={(checkpoint) => {
          const found = post.checkpoints.find((entry) => entry.checkpoint === checkpoint);
          enterMetrics(checkpoint, found?.snapshot ?? null);
        }}
      />
      <Card title="Checkpoint readings" extra={<Typography.Text type="secondary">Latest synced <DateTime value={post.last_synced_at} empty="never" /></Typography.Text>}>
        {post.checkpoints.length || post.adhoc.length ? <CheckpointTable checkpoints={post.checkpoints} adhoc={post.adhoc} metrics={post.applicable_metrics} onEnter={enterMetrics} /> : <Empty description="Metrics will appear after the first checkpoint." />}
      </Card>
      <Card title="Content item">
        <Link to={`/content/${post.content_item.id}?tab=performance`}>Open item performance tab</Link>
      </Card>
      <ManualSnapshotModal
        open={manualOpen}
        publicationId={publicationId}
        checkpoints={post.checkpoints}
        metrics={post.applicable_metrics}
        timezoneName={account?.timezone ?? 'UTC'}
        defaultCheckpoint={manualCheckpoint}
        existing={manualExisting}
        onCancel={() => setManualOpen(false)}
        onSaved={() => { setManualOpen(false); void refresh(); }}
      />
    </Space>
  );
};

const TagFormat: React.FC<{ format: string }> = ({ format }) => <Tag>{format.replace('_', ' ')}</Tag>;

export default PostMetrics;
