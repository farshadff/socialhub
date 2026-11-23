import { useQuery } from '@tanstack/react-query';
import { Link } from '@umijs/max';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Empty,
  Result,
  Skeleton,
  Space,
  Typography,
} from 'antd';
import React from 'react';
import ContentText from '@/components/ContentText';
import DateTime from '@/components/DateTime';
import JobButton from '@/components/JobButton';
import JobProgress from '@/components/JobProgress';
import PageError from '@/components/PageError';
import { CHECK_LABEL, default as CheckCard } from '@/components/quality/CheckCard';
import OutcomeTag from '@/components/quality/OutcomeTag';
import type { ContentItemDetail } from '@/services/socialhub/content';
import { isActive } from '@/services/socialhub/jobs';
import {
  getCheckRun,
  listItemChecks,
  startCheckRun,
  type QCRun,
} from '@/services/socialhub/quality';
import { accountQueryKey } from '@/utils/accountRequest';
import RevisionBanner from './RevisionBanner';

const triggerName: Record<QCRun['trigger'], string> = {
  submission: 'Submitted',
  revision: 'Automatic revision',
  manual_recheck: 'Recheck',
};

const countText = (counts: QCRun['finding_counts']) =>
  (['blocker', 'major', 'minor', 'info'] as const)
    .filter((severity) => counts[severity])
    .map((severity) => `${counts[severity]} ${severity}`)
    .join(' · ') || 'No findings';

const RunCard: React.FC<{ run: QCRun; itemId: number }> = ({ run, itemId }) => (
  <Card
    size="small"
    title={
      <Space wrap>
        <OutcomeTag outcome={run.status === 'failed' ? 'failed' : run.status === 'running' ? 'running' : run.outcome} />
        <Typography.Text strong>Run #{run.attempt}</Typography.Text>
        <Typography.Text type="secondary">Version {run.content_version.version} · {triggerName[run.trigger]}</Typography.Text>
      </Space>
    }
    extra={<DateTime value={run.completed_at ?? run.created_at} />}
  >
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {run.summary ? <Typography.Paragraph style={{ margin: 0 }}>{run.summary}</Typography.Paragraph> : null}
      {run.status === 'failed' ? (
        <Result status="error" title="This check run failed" subTitle={run.summary || 'The run stopped before results were saved.'} />
      ) : run.status === 'running' ? (
        <Alert type="info" showIcon title="Checks are running" />
      ) : (
        <>
          <Typography.Text type="secondary">{countText(run.finding_counts)}</Typography.Text>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
            {run.results.map((result) => <CheckCard key={result.check} result={result} itemId={itemId} runOutcome={run.outcome} />)}
          </div>
        </>
      )}
      {run.content_version.change_note ? <ContentText>{run.content_version.change_note}</ContentText> : null}
    </Space>
  </Card>
);

const ChecksTab: React.FC<{
  item: ContentItemDetail;
  reload: () => unknown;
}> = ({ item, reload }) => {
  const activeJob = item.active_job;
  const canRecheckReview = item.status === 'in_review' && ['qc_escalated', 'max_revisions'].includes(item.open_review_task?.reason ?? '');
  const canRun = (item.status === 'in_check' || canRecheckReview) && !(activeJob && isActive(activeJob.status));
  const listQuery = useQuery({
    queryKey: accountQueryKey(item.account, 'checks', item.id),
    queryFn: () => listItemChecks(item.id),
    refetchInterval: activeJob && isActive(activeJob.status) && activeJob.kind === 'qc.run' ? 3000 : false,
  });
  const runs = listQuery.data?.results ?? [];
  const latest = runs[0] ?? null;
  const latestDetailQuery = useQuery({
    queryKey: accountQueryKey(item.account, 'check-run', latest?.id),
    queryFn: () => latest ? getCheckRun(latest.id) : Promise.reject(new Error('No check run is selected.')),
    enabled: Boolean(latest?.id && latest.status === 'completed'),
  });
  const detail = latestDetailQuery.data;
  const canOpenReview = Boolean(item.open_review_task?.id);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <RevisionBanner item={item} reload={reload} />
      <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>Checks</Typography.Title>
          {latest ? <Typography.Text type="secondary">Version {latest.content_version.version} · latest run</Typography.Text> : null}
        </div>
        <Space wrap>
          {canOpenReview ? <Link to={`/review/${item.open_review_task?.id}`}><Button>Open review task</Button></Link> : null}
          {canRun ? (
            <JobButton
              type="primary"
              start={() => startCheckRun(item.id)}
              activeJob={activeJob}
              kinds={['qc.run']}
              onStarted={reload}
              onDone={() => { reload(); void listQuery.refetch(); }}
              onFailed={() => { reload(); void listQuery.refetch(); }}
              successMessage="Checks complete"
              onStartError={(error) => {
                if (error instanceof Error && 'code' in error && error.code === 'invalid_transition') {
                  reload();
                  return true;
                }
                return false;
              }}
            >
              Run checks again
            </JobButton>
          ) : null}
        </Space>
      </Space>

      {activeJob && isActive(activeJob.status) && activeJob.kind === 'qc.run' ? (
        <JobProgress job={activeJob} title="Quality checks" onDone={() => { reload(); void listQuery.refetch(); }} onFailed={() => { reload(); void listQuery.refetch(); }} />
      ) : null}

      {listQuery.isPending ? <Card><Skeleton active paragraph={{ rows: 5 }} /></Card> : null}
      {listQuery.error ? <PageError error={listQuery.error} onRetry={() => { void listQuery.refetch(); }} /> : null}
      {!listQuery.isPending && !listQuery.error && !runs.length ? (
        <Empty description={item.status === 'in_check' && activeJob ? 'Checks are starting.' : 'Checks run automatically when a version is submitted from Production.'}>
          {item.status !== 'in_check' && <Link to={`/content/${item.id}?tab=production`}><Button>Open Production</Button></Link>}
        </Empty>
      ) : null}

      {latest ? (
        <>
          {latest.status === 'completed' && latestDetailQuery.isPending ? <Card><Skeleton active paragraph={{ rows: 4 }} /></Card> : null}
          {latestDetailQuery.error ? <PageError error={latestDetailQuery.error} onRetry={() => { void latestDetailQuery.refetch(); }} /> : null}
          <RunCard run={detail ?? latest} itemId={item.id} />
        </>
      ) : null}

      {runs.length > 1 ? (
        <Card title="Run history">
          <Collapse
            items={runs.slice(1).map((run) => ({
              key: run.id,
              label: <Space wrap><OutcomeTag outcome={run.status === 'failed' ? 'failed' : run.status === 'running' ? 'running' : run.outcome} /><Typography.Text>Run #{run.attempt}</Typography.Text><Typography.Text type="secondary">Version {run.content_version.version} · {triggerName[run.trigger]}</Typography.Text><DateTime value={run.completed_at ?? run.created_at} /></Space>,
              children: <RunCard run={run} itemId={item.id} />,
            }))}
          />
        </Card>
      ) : null}
      {latest && latest.results.length === 0 && latest.status === 'running' ? <Alert type="info" showIcon title="Waiting for the five checks to finish." /> : null}
      {latest?.results.length ? <Typography.Text type="secondary">Checks: {latest.results.map((result) => CHECK_LABEL[result.check]).join(' · ')}</Typography.Text> : null}
    </Space>
  );
};

export default ChecksTab;
