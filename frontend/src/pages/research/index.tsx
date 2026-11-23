import { DownOutlined } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from '@umijs/max';
import {
  Button,
  Dropdown,
  message,
  notification,
  Select,
  Space,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import React, { useEffect, useMemo, useState } from 'react';
import AccountGate from '@/components/AccountGate';
import JobButton from '@/components/JobButton';
import JobProgress from '@/components/JobProgress';
import { useActiveJob, useJob } from '@/hooks/useJob';
import type { Account } from '@/services/socialhub/accounts';
import { isApiError } from '@/services/socialhub/http';
import type { Job, JobSummary } from '@/services/socialhub/jobs';
import { listPlans, type PlanSummary } from '@/services/socialhub/plans';
import { type StartRunBody, startRun } from '@/services/socialhub/research';
import { useCurrentAccount } from '@/utils/accountRequest';
import { ERROR_TEXT, jobErrorText, notifyError } from '@/utils/errorText';
import { planLabel, TAB_KEYS, type TabKey } from './constants';
import RunOptionsModal from './RunOptionsModal';
import RunsTab from './RunsTab';
import SignalsTab from './SignalsTab';
import SourcesTab from './SourcesTab';
import TopicDrawer from './TopicDrawer';
import TopicsTab from './TopicsTab';

dayjs.extend(utc);
dayjs.extend(timezone);

export type PlanChoice = number | 'none';

const PLAN_STATUS_LABEL: Record<PlanSummary['status'], string> = {
  draft: 'Draft',
  active: 'Active',
  closed: 'Closed',
};

/** The plan the server would pick (E02-S02 rule 5): earliest open plan whose week is not over. */
export function defaultPlanId(
  plans: PlanSummary[],
  tz: string,
  now = dayjs(),
): PlanChoice {
  const today = now.tz(tz).format('YYYY-MM-DD');
  const match = plans
    .filter((plan) => plan.status !== 'closed' && plan.week_end >= today)
    .sort((a, b) => a.week_start.localeCompare(b.week_start))[0];
  return match ? match.id : 'none';
}

export function researchFailureText(job: Job): string {
  switch (job.error_code) {
    case 'all_sources_failed':
      return 'No source could be read. Check the Sources tab.';
    case 'timeout':
      return 'Research took too long and was stopped. Signals found so far were kept.';
    case 'provider_error':
      return ERROR_TEXT.provider_error;
    default:
      return jobErrorText(job);
  }
}

const ResearchWorkspace: React.FC<{ account: Account }> = ({ account }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as TabKey | null;
  const tab: TabKey =
    tabParam && TAB_KEYS.includes(tabParam) ? tabParam : 'topics';
  const planParam = searchParams.get('plan');

  const [refreshKey, setRefreshKey] = useState(0);
  const [runJob, setRunJob] = useState<JobSummary | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [openTopicId, setOpenTopicId] = useState<number | null>(null);
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
    queryKey: [account.id, 'plans', 'all'],
    queryFn: () => listPlans({ account: account.id, ordering: 'week_start' }),
  });
  const plans = plansQuery.data?.results ?? [];
  const openPlans = plans.filter((plan) => plan.status !== 'closed');

  const plan: PlanChoice | null = useMemo(() => {
    if (planParam === 'none') return 'none';
    if (planParam && /^\d+$/.test(planParam)) return Number(planParam);
    return null;
  }, [planParam]);

  useEffect(() => {
    if (plan === null && plansQuery.isSuccess) {
      updateParams({ plan: String(defaultPlanId(plans, account.timezone)) });
    }
  }, [plan, plansQuery.isSuccess]);

  const activeJobQuery = useActiveJob({
    account: account.id,
    kinds: ['research.run'],
  });
  useEffect(() => {
    if (activeJobQuery.data) setRunJob(activeJobQuery.data);
  }, [activeJobQuery.data?.id]);
  const { isActive: runActive } = useJob(runJob?.id ?? null);

  const runBody = (extra: Partial<StartRunBody> = {}): StartRunBody => ({
    account: account.id,
    ...(plan === null ? {} : { plan: plan === 'none' ? null : plan }),
    ...extra,
  });

  /** Errors from starting a run that the page explains itself (E02-S02 Panel). */
  const handleStartError = (error: unknown): boolean => {
    if (!isApiError(error)) return false;
    if (error.fields.some((field) => field.code === 'no_active_sources')) {
      message.warning('Add at least one active source first');
      updateParams({ tab: 'sources' });
      return true;
    }
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
    return false;
  };

  const onRunFinished = () => setRefreshKey((key) => key + 1);

  const planOptions = [
    ...openPlans.map((item) => ({
      value: item.id,
      label: `${planLabel(item)} · ${PLAN_STATUS_LABEL[item.status]}`,
    })),
    { value: 'none' as const, label: 'No plan' },
  ];

  const extra = readOnly
    ? []
    : [
        <Space key="run" size={8} wrap>
          <Typography.Text id="research-plan-label">
            Researching for
          </Typography.Text>
          <Select
            aria-labelledby="research-plan-label"
            style={{ width: 220 }}
            loading={plansQuery.isLoading}
            value={plan ?? undefined}
            options={planOptions}
            onChange={(value: PlanChoice) =>
              updateParams({ plan: String(value) })
            }
          />
          <Space.Compact>
            <JobButton
              type="primary"
              kinds={['research.run']}
              activeJob={runJob}
              start={() => startRun(runBody())}
              onStarted={setRunJob}
              onStartError={handleStartError}
              onDone={onRunFinished}
              onFailed={onRunFinished}
              successMessage={(job) =>
                `Research finished: ${job.result?.signals ?? 0} new signals, ${job.result?.topics ?? 0} topics`
              }
              failureText={researchFailureText}
              runningReason="Research is running."
            >
              Run research
            </JobButton>
            <Dropdown
              disabled={runActive}
              menu={{
                items: [{ key: 'options', label: 'Run with options…' }],
                onClick: () => setOptionsOpen(true),
              }}
            >
              <Button
                type="primary"
                icon={<DownOutlined />}
                aria-label="More run options"
                disabled={runActive}
              />
            </Dropdown>
          </Space.Compact>
        </Space>,
      ];

  const tabProps = {
    account,
    refreshKey,
    readOnly,
    runActive,
    plans,
    onOpenTopic: setOpenTopicId,
  };

  return (
    <PageContainer
      title="Research"
      content="Find what your audience is paying attention to, and keep the evidence."
      extra={extra}
      tabActiveKey={tab}
      onTabChange={(key) => updateParams({ tab: key })}
      tabList={[
        { key: 'topics', tab: 'Topics' },
        { key: 'signals', tab: 'Signals' },
        { key: 'sources', tab: 'Sources' },
        { key: 'runs', tab: 'Runs' },
      ]}
    >
      {runJob && runActive ? (
        <div style={{ marginBottom: 16 }}>
          <JobProgress
            job={runJob}
            title="Research"
            failureText={researchFailureText}
          />
        </div>
      ) : null}
      {tab === 'topics' ? (
        <TopicsTab
          {...tabProps}
          plan={plan}
          onRunResearch={readOnly ? undefined : () => startFromEmptyState()}
        />
      ) : null}
      {tab === 'signals' ? <SignalsTab {...tabProps} /> : null}
      {tab === 'sources' ? <SourcesTab {...tabProps} /> : null}
      {tab === 'runs' ? (
        <RunsTab
          {...tabProps}
          onRunResearch={readOnly ? undefined : () => startFromEmptyState()}
        />
      ) : null}
      <TopicDrawer
        topicId={openTopicId}
        account={account}
        readOnly={readOnly}
        plans={plans}
        onClose={() => setOpenTopicId(null)}
        onChanged={() => setRefreshKey((key) => key + 1)}
      />
      <RunOptionsModal
        open={optionsOpen}
        account={account}
        onOpenChange={setOptionsOpen}
        onSubmit={async (options) => {
          try {
            const response = await startRun(runBody(options));
            setRunJob(response.job);
            return true;
          } catch (error) {
            if (
              isApiError(error) &&
              error.code === 'job_in_progress' &&
              error.details.job
            ) {
              message.info('Already running. Showing its progress.');
              setRunJob(error.details.job as JobSummary);
              return true;
            }
            if (handleStartError(error)) return true;
            throw error;
          }
        }}
      />
    </PageContainer>
  );

  async function startFromEmptyState() {
    try {
      const response = await startRun(runBody());
      setRunJob(response.job);
    } catch (error) {
      if (
        isApiError(error) &&
        error.code === 'job_in_progress' &&
        error.details.job
      ) {
        message.info('Already running. Showing its progress.');
        setRunJob(error.details.job as JobSummary);
      } else if (!handleStartError(error)) {
        notifyError(error);
      }
    }
  }
};

const ResearchPage: React.FC = () => {
  const { account } = useCurrentAccount();
  return (
    <AccountGate title="Research">
      {account ? (
        <ResearchWorkspace key={account.id} account={account} />
      ) : null}
    </AccountGate>
  );
};

export default ResearchPage;
