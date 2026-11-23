import { PageContainer } from '@ant-design/pro-components';
import { history, useParams } from '@umijs/max';
import { Button, Result } from 'antd';
import React from 'react';
import AccountGate from '@/components/AccountGate';
import { useCurrentAccount } from '@/utils/accountRequest';
import PostMetrics from './PostMetrics';

const PostAnalytics: React.FC<{ publicationId: number; accountId: number }> = ({ publicationId, accountId }) => (
  <PageContainer title="Post performance" onBack={() => history.push('/analytics/posts')}>
    <PostMetrics publicationId={publicationId} accountId={accountId} />
  </PageContainer>
);

const PostAnalyticsPage: React.FC = () => {
  const { publicationId = '' } = useParams<{ publicationId: string }>();
  const { accountId } = useCurrentAccount();
  if (!/^\d+$/.test(publicationId)) {
    return <PageContainer title="Post performance"><Result status="404" title="We couldn't find this publication" extra={<Button onClick={() => history.push('/analytics/posts')}>Back to analytics</Button>} /></PageContainer>;
  }
  return <AccountGate title="Post performance">{accountId !== null ? <PostAnalytics key={`${accountId}:${publicationId}`} publicationId={Number(publicationId)} accountId={accountId} /> : null}</AccountGate>;
};

export default PostAnalyticsPage;
