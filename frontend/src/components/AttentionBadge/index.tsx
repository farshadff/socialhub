import { BellOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { history } from '@umijs/max';
import { Badge, Button, Tooltip } from 'antd';
import React from 'react';
import { getOverview, OVERVIEW_KEY } from '@/services/socialhub/overview';
import { useCurrentAccount } from '@/utils/accountRequest';

/** Shared 60-second Overview query used by the page and the top-bar attention count. */
const AttentionBadge: React.FC = () => {
  const { accountId } = useCurrentAccount();
  const query = useQuery({
    queryKey: OVERVIEW_KEY(accountId),
    enabled: accountId !== null,
    queryFn: () => getOverview(accountId as number),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
  const count = query.data?.attention_count;
  const title = query.error ? 'Could not load attention items' : 'Attention items';
  return (
    <Tooltip title={title}>
      <Button
        type="text"
        aria-label="Attention items"
        loading={query.isPending && accountId !== null}
        onClick={() => history.push('/overview')}
        icon={<Badge count={count} showZero={count === 0} overflowCount={99}><BellOutlined aria-hidden="true" /></Badge>}
      />
    </Tooltip>
  );
};

export default AttentionBadge;
