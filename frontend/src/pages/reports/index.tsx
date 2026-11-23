import { PageContainer, ProTable, type ProColumns } from '@ant-design/pro-components';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@umijs/max';
import {
  Alert,
  Button,
  Empty,
  Form,
  Modal,
  Radio,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import React, { useMemo, useState } from 'react';
import AccountGate from '@/components/AccountGate';
import DateTime from '@/components/DateTime';
import JobProgress from '@/components/JobProgress';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import { useActiveJob } from '@/hooks/useJob';
import { listPlans } from '@/services/socialhub/plans';
import { generateWeeklyReport, listWeeklyReports, type ReportListRow, type ReportStatus } from '@/services/socialhub/reports';
import type { JobSummary } from '@/services/socialhub/jobs';
import type { ReportMetric } from '@/services/socialhub/reports';
import { accountQueryKey, useCurrentAccount } from '@/utils/accountRequest';
import { notifyError } from '@/utils/errorText';

const METRIC_LABEL: Record<ReportMetric, string> = { reach: 'Reach', views: 'Views', likes: 'Likes', comments: 'Comments', saves: 'Saves', shares: 'Shares', replies: 'Replies', follower_growth: 'Followers' };

const ReportsPage: React.FC = () => {
  const { accountId } = useCurrentAccount();
  return <AccountGate title="Reports">{accountId !== null ? <ReportsList key={accountId} accountId={accountId} /> : null}</AccountGate>;
};

const ReportsList: React.FC<{ accountId: number }> = ({ accountId }) => {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ReportStatus | undefined>();
  const [modalOpen, setModalOpen] = useState(false);
  const [planId, setPlanId] = useState<number>();
  const [mode, setMode] = useState<'full' | 'totals_only'>('full');
  const [job, setJob] = useState<JobSummary | null>(null);
  const [form] = Form.useForm();
  const reportsKey = accountQueryKey(accountId, 'weekly-reports', status);
  const reportsQuery = useQuery({ queryKey: reportsKey, queryFn: () => listWeeklyReports({ account: accountId, status, ordering: '-week_start', page_size: 100 }) });
  const allReportsQuery = useQuery({ queryKey: accountQueryKey(accountId, 'weekly-reports-all'), queryFn: () => listWeeklyReports({ account: accountId, ordering: '-week_start', page_size: 100 }) });
  const plansQuery = useQuery({ queryKey: accountQueryKey(accountId, 'report-plans'), queryFn: () => listPlans({ account: accountId, status: ['active', 'closed'], ordering: '-week_start' }) });
  const activeJobQuery = useActiveJob({ account: accountId, kinds: ['report.weekly'] });
  const reports = reportsQuery.data?.results ?? [];
  const existingByPlan = useMemo(() => new Map((allReportsQuery.data?.results ?? []).map((report) => [report.plan.id, report])), [allReportsQuery.data]);
  const eligiblePlans = (plansQuery.data?.results ?? []).filter((plan) => existingByPlan.get(plan.id)?.status !== 'accepted');
  const selectedPlan = eligiblePlans.find((plan) => plan.id === planId);
  const existing = selectedPlan ? existingByPlan.get(selectedPlan.id) : undefined;
  const generate = useMutation({
    mutationFn: () => {
      if (!planId) return Promise.reject(new Error('Choose a plan first.'));
      return generateWeeklyReport({ plan: planId, ...(existing?.status === 'draft' ? { mode } : {}) });
    },
    onSuccess: async ({ job: started }) => {
      setJob(started);
      setModalOpen(false);
      message.info('Weekly report started');
      await activeJobQuery.refetch();
      await queryClient.invalidateQueries({ queryKey: accountQueryKey(accountId, 'weekly-reports') });
    },
    onError: (error) => notifyError(error),
  });
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: accountQueryKey(accountId, 'weekly-reports') }),
    queryClient.invalidateQueries({ queryKey: accountQueryKey(accountId, 'report-plans') }),
  ]);

  const columns: ProColumns<ReportListRow>[] = [
    { title: 'Week', key: 'week', render: (_, row) => <Space direction="vertical" size={0}><Link to={`/reports/${row.id}`}>{row.plan.title}</Link><Typography.Text type="secondary">{row.plan.week_start} – {row.plan.week_end}</Typography.Text></Space> },
    { title: 'Plan', dataIndex: ['plan', 'status'], render: (_, row) => <StatusTag kind="plan" status={row.plan.status} /> },
    { title: 'Report', dataIndex: 'status', render: (_, row) => <Space><StatusTag kind="report" status={row.status} />{row.provisional ? <Tag color="warning">Provisional</Tag> : null}</Space> },
    { title: 'Posts', key: 'posts', render: (_, row) => `${row.posts.published} of ${row.posts.planned}` },
    { title: 'Goals', key: 'goals', render: (_, row) => <Space wrap>{row.success_metrics.map((goal) => { const ratio = goal.attainment === null ? null : Number(goal.attainment); return <Tag key={goal.metric} color={ratio === null ? 'default' : ratio >= 1 ? 'success' : 'error'}>{METRIC_LABEL[goal.metric] ?? 'Followers'} {ratio === null ? '—' : `${Math.round(ratio * 100)}%`}</Tag>; })}</Space> },
    { title: 'Followers', dataIndex: 'follower_change', render: (_, row) => row.follower_change === null ? '—' : `${row.follower_change >= 0 ? '+' : ''}${row.follower_change.toLocaleString('en-US')}` },
    { title: 'Findings', key: 'findings', render: (_, row) => `${row.findings_count.accepted} accepted · ${row.findings_count.undecided} undecided` },
    { title: 'Applied to', key: 'applied', render: (_, row) => row.applied_plan ? <Link to={`/plans/${row.applied_plan.id}`}>{row.applied_plan.title}</Link> : '—' },
    { title: 'Generated', dataIndex: 'generated_at', render: (_, row) => <DateTime value={row.generated_at} /> },
    { title: '', key: 'actions', valueType: 'option', render: (_, row) => [<Link key="open" to={`/reports/${row.id}`}>Open</Link>, ...(row.status === 'accepted' && !row.applied_plan ? [<Link key="apply" to={`/reports/${row.id}?apply=1`}>Apply to next plan</Link>] : [])] },
  ];

  return (
    <PageContainer title="Reports" content="One report per weekly plan.">
      <ProTable<ReportListRow>
        rowKey="id"
        headerTitle={false}
        columns={columns}
        dataSource={reports}
        loading={reportsQuery.isPending || reportsQuery.isFetching}
        search={false}
        options={false}
        toolBarRender={() => [<Select key="status" allowClear value={status} placeholder="All statuses" style={{ width: 160 }} options={[{ value: 'draft', label: 'Draft' }, { value: 'accepted', label: 'Accepted' }]} onChange={(value) => setStatus(value)} />,
          <Button key="generate" type="primary" onClick={() => { setPlanId(undefined); form.resetFields(); setModalOpen(true); }}>Generate report</Button>]}
        pagination={{ pageSize: 10, showSizeChanger: false }}
        locale={{ emptyText: <Empty description="No reports yet. A report is prepared when a plan is closed."><Button type="primary" onClick={() => setModalOpen(true)}>Generate report</Button></Empty> }}
        tableAlertRender={false}
      />
      {reportsQuery.error ? <PageError error={reportsQuery.error} onRetry={() => { void reportsQuery.refetch(); }} /> : null}
      <JobProgress job={activeJobQuery.data ?? job} title="Weekly report" onDone={() => { void refresh(); setJob(null); }} onFailed={() => { void refresh(); setJob(null); }} />
      <Modal title="Generate weekly report" open={modalOpen} okText="Generate" okButtonProps={{ disabled: !planId }} confirmLoading={generate.isPending} onCancel={() => setModalOpen(false)} onOk={() => form.submit()} destroyOnHidden>
        {plansQuery.error ? <PageError error={plansQuery.error} onRetry={() => { void plansQuery.refetch(); }} /> : null}
        <Form form={form} layout="vertical" onFinish={() => generate.mutate()}>
          <Form.Item label="Weekly plan" required>
            <Select value={planId} onChange={(value: number) => { setPlanId(value); setMode('full'); }} placeholder="Choose an active or closed plan" loading={plansQuery.isPending} options={eligiblePlans.map((plan) => ({ value: plan.id, label: `${plan.title} — ${plan.status}` }))} />
          </Form.Item>
          {existing?.status === 'draft' ? <Form.Item label="Existing draft report"><Radio.Group value={mode} onChange={(event) => setMode(event.target.value)} options={[{ value: 'full', label: 'Replace summary and findings' }, { value: 'totals_only', label: 'Refresh numbers only' }]} /></Form.Item> : null}
          {existing?.status === 'draft' ? <Alert type="warning" showIcon title="Replacing summary and findings will discard your edits." /> : null}
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default ReportsPage;
