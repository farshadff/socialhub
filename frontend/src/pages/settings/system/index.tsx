import { PageContainer } from '@ant-design/pro-components';
import { history, useSearchParams } from '@umijs/max';
import React from 'react';
import Forbidden from '@/pages/exception/403';
import { useIsAdmin } from '@/utils/accountRequest';
import AiCallsTab from './AiCallsTab';
import JobsTab from './JobsTab';
import StatusTab from './StatusTab';

const TABS = [
  { key: 'status', tab: 'Status' },
  { key: 'ai-calls', tab: 'AI calls' },
  { key: 'jobs', tab: 'Jobs' },
] as const;

type SystemTab = (typeof TABS)[number]['key'];

const isSystemTab = (value: string | null): value is SystemTab =>
  TABS.some((tab) => tab.key === value);

/**
 * Settings → System (E00-S05, E00-S06): Status, AI calls and Jobs tabs, selected by `?tab=`.
 * Admin only: the route has `access: 'canAdmin'`; the check here covers a stale session.
 */
const SystemPage: React.FC = () => {
  const isAdmin = useIsAdmin();
  const [searchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  const tab: SystemTab = isSystemTab(requested) ? requested : 'status';

  if (!isAdmin) return <Forbidden />;

  return (
    <PageContainer
      title="System"
      content="Integration status and AI usage."
      tabList={TABS.map((item) => ({ key: item.key, tab: item.tab }))}
      tabActiveKey={tab}
      onTabChange={(key) => history.push(`/settings/system?tab=${key}`)}
    >
      {tab === 'status' ? <StatusTab /> : null}
      {tab === 'ai-calls' ? <AiCallsTab /> : null}
      {tab === 'jobs' ? <JobsTab /> : null}
    </PageContainer>
  );
};

export default SystemPage;
