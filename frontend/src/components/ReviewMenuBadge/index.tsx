import { useQuery } from '@tanstack/react-query';
import { Badge } from 'antd';
import React from 'react';
import { listReviewTasks } from '@/services/socialhub/quality';
import { accountQueryKey, useAccountId } from '@/utils/accountRequest';

const ReviewMenuBadge: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const accountId = useAccountId();
  const query = useQuery({
    queryKey: accountQueryKey(accountId, 'review-count'),
    enabled: accountId !== null,
    queryFn: async () => (await listReviewTasks({ account: accountId as number, status: 'open', page: 1, page_size: 1 })).count,
    refetchInterval: 60_000,
  });
  return (
    <Badge count={query.data ?? 0} size="small" overflowCount={99}>
      <span style={{ display: 'block', width: '100%' }}>{children}</span>
    </Badge>
  );
};

export default ReviewMenuBadge;
