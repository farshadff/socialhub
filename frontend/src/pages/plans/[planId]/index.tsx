import { PageContainer } from '@ant-design/pro-components';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { history, useParams, useSearchParams } from '@umijs/max';
import { message, Skeleton, Space, Typography } from 'antd';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import AccountGate from '@/components/AccountGate';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import type { Account } from '@/services/socialhub/accounts';
import { getPlan, type Plan, updatePlan } from '@/services/socialhub/plans';
import { useCurrentAccount } from '@/utils/accountRequest';
import { notifyError } from '@/utils/errorText';
import PlanActions from '../components/PlanActions';
import PlanTab from '../components/PlanTab';
import SlotsTab from '../components/SlotsTab';
import { weekRange } from '../shared';

type TabKey = 'plan' | 'slots';

export const planKey = (accountId: number, planId: number | string) => [
  accountId,
  'plan',
  Number(planId),
];

const PlanEditor: React.FC<{ account: Account; planId: string }> = ({ account, planId }) => {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: TabKey = searchParams.get('tab') === 'slots' ? 'slots' : 'plan';
  const saveRef = useRef<(() => Promise<boolean>) | null>(null);
  const [dirty, setDirty] = useState(false);

  const query = useQuery({
    queryKey: planKey(account.id, planId),
    queryFn: () => getPlan(planId),
  });
  const plan = query.data;

  // The plan belongs to another account after a switch: go back to the list (E00-S02 rule 20).
  useEffect(() => {
    if (plan && plan.account !== account.id) history.replace('/plans');
  }, [plan, account.id]);

  const setTab = (next: TabKey) => {
    searchParams.set('tab', next);
    setSearchParams(searchParams, { replace: true });
  };

  useEffect(() => {
    if (searchParams.get('findings') !== '1' || !plan) return;
    if (tab !== 'plan') setTab('plan');
    const timer = window.setTimeout(() => {
      document.getElementById('carried-findings')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.getElementById('carried-findings')?.focus({ preventScroll: true });
      const next = new URLSearchParams(searchParams);
      next.delete('findings');
      setSearchParams(next, { replace: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [plan?.id, searchParams.get('findings')]);

  const registerSave = useCallback(
    (save: (() => Promise<boolean>) | null, isDirty: boolean) => {
      saveRef.current = save;
      setDirty(isDirty);
    },
    [],
  );

  const refresh = useCallback(
    (updated?: Plan) => {
      if (updated) queryClient.setQueryData(planKey(account.id, planId), updated);
      queryClient.invalidateQueries({ queryKey: [account.id, 'plans'] });
      queryClient.invalidateQueries({ queryKey: planKey(account.id, planId) });
    },
    [queryClient, account.id, planId],
  );

  const renameTitle = async (title: string) => {
    const value = title.trim();
    if (!plan || !value || value === plan.title) return;
    try {
      refresh(await updatePlan(plan.id, { title: value.slice(0, 120) }));
      message.success('Title saved');
    } catch (error) {
      notifyError(error);
      refresh();
    }
  };

  if (query.isLoading) {
    return (
      <PageContainer title="Weekly plan">
        <Skeleton active paragraph={{ rows: 10 }} />
      </PageContainer>
    );
  }
  if (query.isError || !plan) {
    return (
      <PageContainer title="Weekly plan">
        <PageError error={query.error} onRetry={query.refetch} />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title={
        <Typography.Title
          level={4}
          style={{ margin: 0 }}
          editable={
            plan.status === 'closed'
              ? false
              : { onChange: renameTitle, maxLength: 120, tooltip: 'Rename plan' }
          }
        >
          {plan.title}
        </Typography.Title>
      }
      subTitle={
        <Space>
          <Typography.Text type="secondary">{weekRange(plan.week_start, plan.week_end)}</Typography.Text>
          <StatusTag kind="plan" status={plan.status} />
        </Space>
      }
      onBack={() => history.push('/plans')}
      extra={
        <PlanActions
          plan={plan}
          account={account}
          dirty={dirty}
          saveFirst={() => saveRef.current?.() ?? Promise.resolve(true)}
          onChanged={refresh}
        />
      }
      tabActiveKey={tab}
      onTabChange={(key) => setTab(key as TabKey)}
      tabList={[
        { key: 'plan', tab: 'Plan' },
        { key: 'slots', tab: `Slots (${plan.slot_summary.total})` },
      ]}
    >
      {/* The Plan tab stays mounted so unsaved edits survive a visit to Slots. */}
      <div hidden={tab !== 'plan'}>
        <PlanTab
          plan={plan}
          account={account}
          active={tab === 'plan'}
          onSaved={refresh}
          onConflict={() => refresh()}
          onGoToSlots={() => setTab('slots')}
          registerSave={registerSave}
        />
      </div>
      {tab === 'slots' && <SlotsTab plan={plan} account={account} onChanged={() => refresh()} />}
    </PageContainer>
  );
};

const PlanPage: React.FC = () => {
  const { planId = '' } = useParams<{ planId: string }>();
  const { account } = useCurrentAccount();
  return (
    <AccountGate title="Weekly plan">
      {account && <PlanEditor key={`${account.id}-${planId}`} account={account} planId={planId} />}
    </AccountGate>
  );
};

export default PlanPage;
