import { ThunderboltOutlined } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { history, useSearchParams } from '@umijs/max';
import {
  Alert,
  Button,
  Empty,
  notification,
  Select,
  Skeleton,
  Space,
  Tabs,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import React, { useEffect, useState } from 'react';
import AccountGate from '@/components/AccountGate';
import { formatDateTime } from '@/components/DateTime';
import JobButton from '@/components/JobButton';
import PageError from '@/components/PageError';
import { useActiveJob, useJob } from '@/hooks/useJob';
import type { Account } from '@/services/socialhub/accounts';
import { isApiError } from '@/services/socialhub/http';
import type { Job, JobSummary } from '@/services/socialhub/jobs';
import { listPlans } from '@/services/socialhub/plans';
import {
  getCurrentPlan,
  getProposal,
  listCandidates,
  startRanking,
} from '@/services/socialhub/selection';
import { useCurrentAccount } from '@/utils/accountRequest';
import { ERROR_TEXT, jobErrorText, notifyError } from '@/utils/errorText';
import CandidatesTab from './CandidatesTab';
import FeedItemsTab from './FeedItemsTab';
import FeedSourcesTab from './FeedSourcesTab';
import {
  defaultPlanId,
  planOptionLabel,
  rankResultText,
  summaryLine,
  TAB_KEYS,
  type TabKey,
} from './logic';
import ProposalTab from './ProposalTab';
import type { SelectionTabProps } from './shared';
import RepurposeTasks from './components/RepurposeTasks';

dayjs.extend(utc);
dayjs.extend(timezone);

export function rankFailureText(job: Job): string {
  switch (job.error_code) {
    case 'provider_not_configured':
      return 'The AI provider is not configured. Ask an admin to check Settings → System.';
    case 'provider_error':
      return ERROR_TEXT.provider_error;
    default:
      return jobErrorText(job);
  }
}

const SelectionWorkspace: React.FC<{ account: Account }> = ({ account }) => {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as TabKey | null;
  const tab: TabKey =
    tabParam && TAB_KEYS.includes(tabParam) ? tabParam : 'candidates';
  const planParam = searchParams.get('plan');
  const [refreshKey, setRefreshKey] = useState(0);
  const [rankJob, setRankJob] = useState<JobSummary | null>(null);
  const readOnly = account.status === 'archived';

  const updateParams = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  };

  const plansQuery = useQuery({
    queryKey: [account.id, 'plans', 'open'],
    queryFn: () =>
      listPlans({ account: account.id, status: ['draft', 'active'] }),
  });
  const currentPlanQuery = useQuery({
    queryKey: [account.id, 'plans', 'current'],
    queryFn: async () => {
      try {
        return await getCurrentPlan(account.id);
      } catch (error) {
        if (isApiError(error) && error.status === 404) return null;
        throw error;
      }
    },
    retry: false,
  });
  const plans = plansQuery.data?.results ?? [];
  const plansSettled = plansQuery.isSuccess && !currentPlanQuery.isLoading;

  const planId =
    planParam && /^\d+$/.test(planParam) ? Number(planParam) : null;
  const plan = plans.find((p) => p.id === planId) ?? null;

  useEffect(() => {
    if (!plansSettled) return;
    if (planId !== null && plans.some((p) => p.id === planId)) return;
    const today = dayjs().tz(account.timezone).format('YYYY-MM-DD');
    const next = defaultPlanId(plans, currentPlanQuery.data?.id ?? null, today);
    if (next !== null && next !== planId) updateParams({ plan: String(next) });
  }, [plansSettled, planId, plans.length]);

  const selectedPlanId = plan?.id ?? 0;
  const proposalQuery = useQuery({
    queryKey: [account.id, 'selection-proposal', plan?.id, refreshKey],
    queryFn: () => getProposal({ account: account.id, plan: selectedPlanId }),
    enabled: plan !== null,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
  });
  const countQuery = useQuery({
    queryKey: [account.id, 'selection-candidate-count', plan?.id, refreshKey],
    queryFn: () =>
      listCandidates({
        account: account.id,
        plan: selectedPlanId,
        status: ['candidate', 'proposed'],
        page_size: 1,
      }),
    enabled: plan !== null,
    placeholderData: (previous) => previous,
  });

  const activeJobQuery = useActiveJob({
    account: account.id,
    kinds: ['selection.rank'],
    targetType: 'plan',
    targetId: plan ? String(plan.id) : undefined,
  });
  useEffect(() => {
    if (activeJobQuery.data) setRankJob(activeJobQuery.data);
  }, [activeJobQuery.data?.id]);
  const { isActive: rankRunning } = useJob(rankJob?.id ?? null);

  const refresh = () => {
    setRefreshKey((key) => key + 1);
    queryClient.invalidateQueries({ queryKey: [account.id, 'feed-sources'] });
  };

  const proposal = proposalQuery.data;
  const openSlots = proposal
    ? proposal.assignments.length + proposal.unfilled_slots.length
    : 0;
  const rankedLabel = proposal?.ranked_at
    ? formatDateTime(proposal.ranked_at, account.timezone, 'datetime')
    : null;
  const autopilot = proposal?.autopilot ?? account.autopilot.selection;

  const handleStartError = (error: unknown): boolean => {
    if (!isApiError(error)) return false;
    if (error.code === 'provider_not_configured') {
      notification.error({
        title:
          'The AI provider is not configured. Ask an admin to check Settings → System.',
        description: error.request_id
          ? `Reference: ${error.request_id}`
          : undefined,
      });
      return true;
    }
    if (error.code === 'invalid_transition') {
      notification.warning({
        title: 'This plan is closed. Choose a draft or active plan.',
      });
      return true;
    }
    return false;
  };

  /** "Rank candidates" in an empty state; the header button follows the job it starts. */
  const rankFromEmpty = async () => {
    if (!plan) return;
    try {
      const response = await startRanking(plan.id);
      setRankJob(response.job);
    } catch (error) {
      if (
        isApiError(error) &&
        error.code === 'job_in_progress' &&
        error.details.job
      ) {
        setRankJob(error.details.job as JobSummary);
      } else if (!handleStartError(error)) {
        notifyError(error);
      }
    }
  };

  const tabProps: SelectionTabProps = {
    account,
    plan,
    refreshKey,
    rankRunning,
    onChanged: refresh,
    goToTab: (next) => updateParams({ tab: next }),
  };

  const noPlan = plansSettled && plans.length === 0;
  const planNeeded = (node: React.ReactNode) => {
    if (plansQuery.error) {
      return (
        <PageError
          error={plansQuery.error}
          onRetry={() => plansQuery.refetch()}
        />
      );
    }
    if (noPlan) {
      return (
        <Empty description="Create a weekly plan first.">
          <Button type="primary" onClick={() => history.push('/plans')}>
            Go to weekly plan
          </Button>
        </Empty>
      );
    }
    if (!plan) return <Skeleton active />;
    return node;
  };

  const header = (
    <Space orientation="vertical" size={4}>
      <Typography.Text type="secondary">
        Rank this week's candidates and fill the open slots.
      </Typography.Text>
      {plan && proposal ? (
        <Typography.Text>
          {summaryLine(openSlots, countQuery.data?.count ?? 0, rankedLabel)}
        </Typography.Text>
      ) : null}
    </Space>
  );

  return (
    <PageContainer
      title="Selection"
      content={header}
      extra={[
        <Select<number>
          key="plan"
          aria-label="Plan"
          style={{ minWidth: 240 }}
          placeholder={noPlan ? 'No draft or active plan' : 'Choose a plan'}
          loading={plansQuery.isLoading}
          disabled={noPlan}
          value={plan?.id}
          onChange={(value) => updateParams({ plan: String(value) })}
          options={plans
            .slice()
            .sort((a, b) => a.week_start.localeCompare(b.week_start))
            .map((p) => ({ value: p.id, label: planOptionLabel(p) }))}
        />,
        readOnly || !plan ? null : (
          <JobButton
            key="rank"
            type="primary"
            icon={<ThunderboltOutlined />}
            start={() => startRanking(plan.id)}
            activeJob={rankJob}
            kinds={['selection.rank']}
            onStarted={setRankJob}
            onStartError={handleStartError}
            successMessage={(job) => rankResultText(job.result)}
            failureText={rankFailureText}
            onDone={refresh}
            onFailed={refresh}
          >
            Rank candidates
          </JobButton>
        ),
      ]}
    >
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        {autopilot && plan ? (
          <Alert
            type="info"
            showIcon
            title="Selection autopilot is on. Ranking an active plan confirms the proposal automatically."
          />
        ) : null}
        <Tabs
          activeKey={tab}
          onChange={(next) => updateParams({ tab: next })}
          items={[
            {
              key: 'candidates',
              label: 'Candidates',
              children: planNeeded(
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <RepurposeTasks
                    accountId={account.id}
                    planId={plan?.id}
                    readOnly={readOnly}
                    rankRunning={rankRunning}
                    onChanged={refresh}
                  />
                  <CandidatesTab
                    {...tabProps}
                    proposal={proposal}
                    onRank={rankFromEmpty}
                  />
                </Space>,
              ),
            },
            {
              key: 'proposal',
              label: 'Proposal',
              children: planNeeded(
                <ProposalTab
                  {...tabProps}
                  proposal={proposal}
                  loading={proposalQuery.isLoading}
                  error={proposalQuery.error}
                  reloadProposal={() => proposalQuery.refetch()}
                  onRank={rankFromEmpty}
                />,
              ),
            },
            {
              key: 'feed-items',
              label: 'Feed items',
              children: <FeedItemsTab {...tabProps} />,
            },
            {
              key: 'feed-sources',
              label: 'Feed sources',
              children: <FeedSourcesTab {...tabProps} />,
            },
          ]}
        />
      </Space>
    </PageContainer>
  );
};

const SelectionPage: React.FC = () => {
  const { account } = useCurrentAccount();
  return (
    <AccountGate title="Selection">
      {account ? (
        <SelectionWorkspace key={account.id} account={account} />
      ) : null}
    </AccountGate>
  );
};

export default SelectionPage;
