import { Empty, Card } from 'antd';
import React from 'react';
import type { WorkspaceTabProps } from '@/pages/content/workspace/types';
import PostMetrics from '@/pages/analytics/posts/PostMetrics';

const PerformanceTab: React.FC<WorkspaceTabProps> = ({ item }) => {
  if (!item.publication?.id || item.status !== 'published') {
    return (
      <Card title="Performance">
        <Empty description="Post metrics appear here after the item is published." />
      </Card>
    );
  }
  return <PostMetrics publicationId={item.publication.id} accountId={item.account} />;
};

export default PerformanceTab;
