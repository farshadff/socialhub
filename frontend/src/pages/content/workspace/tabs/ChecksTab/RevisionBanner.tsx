import { Alert, Button, Space, Typography } from 'antd';
import { Link } from '@umijs/max';
import React from 'react';
import JobButton from '@/components/JobButton';
import JobProgress from '@/components/JobProgress';
import type { ContentItemDetail } from '@/services/socialhub/content';
import { retryRevision } from '@/services/socialhub/quality';
import { useCurrentAccount } from '@/utils/accountRequest';

const RevisionBanner: React.FC<{
  item: ContentItemDetail;
  reload: () => unknown;
}> = ({ item, reload }) => {
  const { account } = useCurrentAccount();
  const failed = item.status === 'in_production' && item.hold_reason.startsWith('Automatic revision failed at');
  if (failed) {
    return (
      <Alert
        type="error"
        showIcon
        title="The automatic revision failed."
        description={
          <Space direction="vertical">
            <Typography.Text>{item.hold_reason}</Typography.Text>
            <Space wrap>
              <JobButton
                type="primary"
                start={() => retryRevision(item.id)}
                activeJob={item.active_job}
                kinds={['qc.revise']}
                successMessage="Revision restarted"
                onStarted={reload}
                onDone={reload}
                onFailed={reload}
                onStartError={(error) => {
                  if (error instanceof Error && 'code' in error && error.code === 'invalid_transition') {
                    reload();
                    return true;
                  }
                  return false;
                }}
              >
                Retry revision
              </JobButton>
              <Link to={`/content/${item.id}?tab=production`}>
                <Button>Open Production</Button>
              </Link>
            </Space>
          </Space>
        }
      />
    );
  }
  if (item.status === 'in_review' && item.open_review_task?.reason === 'max_revisions') {
    return (
      <Alert
        type="warning"
        showIcon
        title={`Still needs revision after ${item.auto_revision_count ?? item.revision_count} automatic revisions. Waiting for review.`}
        action={item.open_review_task ? <Link to={`/review/${item.open_review_task.id}`}><Button size="small">Open review task</Button></Link> : undefined}
      />
    );
  }
  if (item.status === 'in_production' && item.hold_reason.startsWith('Changes requested:')) {
    return (
      <Alert
        type="warning"
        showIcon
        title={item.hold_reason}
        action={<Link to={`/content/${item.id}?tab=production`}><Button size="small">Open Production</Button></Link>}
      />
    );
  }
  const revisionActive = item.active_job?.kind === 'qc.revise' && ['queued', 'running'].includes(item.active_job.status);
  if (item.status === 'needs_revision' || revisionActive) {
    const nextRevision = (item.auto_revision_count ?? item.revision_count) + 1;
    const maxRevisions = account?.posting_rules?.max_revisions ?? 2;
    return (
      <Alert
        type="info"
        showIcon
        title={`Automatic revision ${nextRevision} of ${maxRevisions} in progress`}
        description={item.active_job?.message || 'The next version will be checked automatically.'}
        action={item.active_job ? <JobProgress job={item.active_job} variant="inline" onDone={reload} onFailed={reload} /> : undefined}
      />
    );
  }
  return null;
};

export default RevisionBanner;
