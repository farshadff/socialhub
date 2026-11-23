import { Column } from '@ant-design/plots';
import { PageContainer } from '@ant-design/pro-components';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { history, Link, useParams, useSearchParams } from '@umijs/max';
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Radio,
  Result,
  Row,
  Col,
  Segmented,
  Select,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useEffect, useRef, useState } from 'react';
import AccountGate from '@/components/AccountGate';
import ContentText from '@/components/ContentText';
import DateTime from '@/components/DateTime';
import JobProgress from '@/components/JobProgress';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import { useActiveJob } from '@/hooks/useJob';
import { getPlan } from '@/services/socialhub/plans';
import {
  acceptWeeklyReport,
  applyReportToPlan,
  generateWeeklyReport,
  getWeeklyReport,
  previewReportApplication,
  updateWeeklyReport,
  type ApplyDryRun,
  type ReportFinding,
  type ReportMetricTotal,
  type ReportPostRow,
} from '@/services/socialhub/reports';
import type { EvaluationMetric } from '@/services/socialhub/evaluations';
import { accountQueryKey, useCurrentAccount } from '@/utils/accountRequest';
import { isApiError } from '@/services/socialhub/http';
import { notifyError } from '@/utils/errorText';

const METRIC_LABEL: Record<EvaluationMetric, string> = { reach: 'Reach', views: 'Views', likes: 'Likes', comments: 'Comments', saves: 'Saves', shares: 'Shares', replies: 'Replies' };
const PLAN_FIELD_LABEL: Record<ReportFinding['plan_field'], string> = { objective: 'Objective', audience: 'Audience', goals: 'Goals', slots: 'Slots', notes: 'Notes', none: '' };
const numberText = (value: number | null | undefined) => value === null || value === undefined ? '—' : value.toLocaleString('en-US');

const ReportPage: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const { accountId } = useCurrentAccount();
  if (!/^\d+$/.test(id)) return <PageContainer title="Report"><Result status="404" title="We couldn't find this report" extra={<Button onClick={() => history.push('/reports')}>Back to reports</Button>} /></PageContainer>;
  return <AccountGate title="Report">{accountId !== null ? <ReportDetail key={`${accountId}:${id}`} reportId={Number(id)} accountId={accountId} /> : null}</AccountGate>;
};

const ReportDetail: React.FC<{ reportId: number; accountId: number }> = ({ reportId, accountId }) => {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [summary, setSummary] = useState('');
  const [summaryDirty, setSummaryDirty] = useState(false);
  const [findingDrawer, setFindingDrawer] = useState<{ open: boolean; finding: ReportFinding | null }>({ open: false, finding: null });
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [decideRemaining, setDecideRemaining] = useState<'accept' | 'dismiss'>('accept');
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyPlanChoice, setApplyPlanChoice] = useState<number | 'default'>('default');
  const [applyError, setApplyError] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<'chart' | 'table'>('chart');
  const applyFromLink = useRef(false);
  const reportKey = accountQueryKey(accountId, 'weekly-report', reportId);
  const reportQuery = useQuery({ queryKey: reportKey, queryFn: () => getWeeklyReport(reportId) });
  const report = reportQuery.data;
  const activeJobQuery = useActiveJob({ account: accountId, kinds: ['report.weekly'], targetType: 'plan', targetId: report ? String(report.plan.id) : undefined });
  const appliedPlanId = report?.applied_plan?.id;
  const appliedPlanQuery = useQuery({
    queryKey: accountQueryKey(accountId, 'plan', appliedPlanId),
    queryFn: () => appliedPlanId === undefined ? Promise.reject(new Error('No applied plan is linked to this report.')) : getPlan(appliedPlanId),
    enabled: appliedPlanId !== undefined,
  });
  const reportPlan = report?.applied_plan?.id ? appliedPlanQuery.data : null;

  useEffect(() => {
    if (report && report.account !== accountId) history.replace('/reports');
  }, [report?.account, accountId]);
  useEffect(() => {
    if (report && !summaryDirty) setSummary(report.summary ?? '');
  }, [report?.id, report?.summary, summaryDirty]);
  useEffect(() => {
    if (searchParams.get('apply') === '1' && report?.status === 'accepted' && !applyFromLink.current) {
      applyFromLink.current = true;
      const next = new URLSearchParams(searchParams);
      next.delete('apply');
      setSearchParams(next, { replace: true });
      void beginApply();
    }
  }, [searchParams, report?.status]);

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: reportKey }),
    queryClient.invalidateQueries({ queryKey: accountQueryKey(accountId, 'weekly-reports') }),
  ]);
  const saveSummary = useMutation({
    mutationFn: () => updateWeeklyReport(reportId, { summary }),
    onSuccess: (updated) => { queryClient.setQueryData(reportKey, updated); setSummaryDirty(false); message.success('Summary saved'); },
    onError: (error) => { if (isApiError(error) && error.status === 409) { message.warning('This report changed. Reloading.'); void reportQuery.refetch(); } else notifyError(error); },
  });
  const saveFindings = useMutation({
    mutationFn: (findings: (Omit<ReportFinding, 'id'> & { id?: string })[]) => updateWeeklyReport(reportId, { findings }),
    onSuccess: (updated) => { queryClient.setQueryData(reportKey, updated); setFindingDrawer({ open: false, finding: null }); },
    onError: (error) => { if (isApiError(error) && error.status === 409) { message.warning('This report changed. Reloading.'); void reportQuery.refetch(); } else notifyError(error); },
  });
  const accept = useMutation({
    mutationFn: (choice?: 'accept' | 'dismiss') => acceptWeeklyReport(reportId, choice ? { decide_remaining: choice } : undefined),
    onSuccess: (updated) => { queryClient.setQueryData(reportKey, updated); setAcceptOpen(false); message.success('Report accepted'); },
    onError: (error) => { if (isApiError(error) && error.status === 409) { message.warning('This report changed. Reloading.'); void reportQuery.refetch(); } else notifyError(error); },
  });
  const previewApply = useMutation({
    mutationFn: (plan?: number) => previewReportApplication(reportId, plan),
    onSuccess: (_preview, requestedPlan) => { setApplyPlanChoice(requestedPlan ?? 'default'); setApplyError(null); setApplyOpen(true); },
    onError: (error) => {
      if (isApiError(error) && error.details.reason === 'already_applied') { message.info('This report is already applied to another plan.'); void reportQuery.refetch(); }
      else notifyError(error);
    },
  });
  const applyMutation = useMutation({
    mutationFn: (choice: number | 'default') => applyReportToPlan(reportId, choice === 'default' ? {} : { plan: choice }),
    onSuccess: async (result) => {
      setApplyOpen(false);
      await refresh();
      message.success(result.changed ? `${result.added} findings added to ${result.plan.title}` : 'Findings are already in the plan');
      history.push(`/plans/${result.plan.id}?findings=1`);
    },
    onError: (error) => {
      if (isApiError(error) && error.details.reason === 'plan_closed') { setApplyError('That plan was closed in the meantime. Choose another plan.'); void reportQuery.refetch(); void previewApply.mutateAsync().catch(() => undefined); }
      else if (isApiError(error) && error.details.reason === 'cannot_create_plan') setApplyError(`A new plan could not be created: ${error.details.problem ?? 'unknown reason'}. Choose an existing plan or create one in Weekly plan.`);
      else if (isApiError(error) && error.details.reason === 'already_applied') { setApplyError('This report is already applied to another plan.'); void reportQuery.refetch(); }
      else notifyError(error);
    },
  });

  const beginApply = (plan?: number) => previewApply.mutateAsync(plan).catch(() => undefined);
  const applyPreview = previewApply.data as ApplyDryRun | undefined;
  const findings = report?.findings ?? [];
  const undecided = findings.filter((finding) => finding.accepted === null).length;
  const jobRunning = Boolean(activeJobQuery.data && ['queued', 'running'].includes(activeJobQuery.data.status));
  const actionsDisabled = report?.status !== 'draft' || jobRunning || saveFindings.isPending;
  const posts = report?.totals.post_rows ?? [];
  const planFindingState = (finding: ReportFinding) => reportPlan?.carried_findings.find((item) => item.report_id === reportId && item.id === finding.id)?.state;

  const replaceFindings = (next: (Omit<ReportFinding, 'id'> & { id?: string })[]) => saveFindings.mutate(next);
  const decide = (finding: ReportFinding, value: boolean | null) => replaceFindings(findings.map((entry) => ({ ...entry, accepted: entry.id === finding.id ? value : entry.accepted })));
  const removeFinding = (finding: ReportFinding) => replaceFindings(findings.filter((entry) => entry.id !== finding.id));
  const acceptAll = () => replaceFindings(findings.map((entry) => ({ ...entry, accepted: entry.accepted === null ? true : entry.accepted })));
  const startGenerate = async (mode: 'full' | 'totals_only') => {
    if (!report) return;
    try {
      const { job } = await generateWeeklyReport({ plan: report.plan.id, mode });
      queryClient.setQueryData([accountId, 'active-job', ['report.weekly'], 'plan', String(report.plan.id)], job);
      void activeJobQuery.refetch();
    } catch (error) { notifyError(error); }
  };

  if (reportQuery.isPending) return <PageContainer title="Weekly report"><Skeleton active paragraph={{ rows: 10 }} /></PageContainer>;
  if (reportQuery.error || !report) return <PageContainer title="Weekly report"><PageError error={reportQuery.error} onRetry={() => { void reportQuery.refetch(); }} /></PageContainer>;
  const totals = report.totals;
  const metrics = Object.entries(totals.metrics).filter(([, metric]) => metric.is_success_metric) as [EvaluationMetric, ReportMetricTotal][];
  const chartData = metrics.flatMap(([metric, total]) => [
    { metric: METRIC_LABEL[metric], kind: 'Actual', value: total.actual ?? 0 },
    { metric: METRIC_LABEL[metric], kind: 'Goal', value: total.goal ?? 0 },
  ]).filter((entry) => entry.kind === 'Actual' || metrics.some(([metric, total]) => METRIC_LABEL[metric] === entry.metric && total.goal !== null));
  const postColumns: ColumnsType<ReportPostRow> = [
    { title: 'Post', dataIndex: 'title', render: (_, row) => {
      const best = Object.entries(totals.best).filter(([, item]) => item?.publication === row.publication).map(([metric]) => `Best ${METRIC_LABEL[metric as EvaluationMetric]}`);
      const worst = Object.entries(totals.worst).filter(([, item]) => item?.publication === row.publication).map(([metric]) => `Lowest ${METRIC_LABEL[metric as EvaluationMetric]}`);
      return <Space direction="vertical" size={2}><Link to={row.content_item ? `/content/${row.content_item}` : `/analytics/posts/${row.publication}`}><ContentText>{row.title}</ContentText></Link><Space wrap>{[...best, ...worst].map((label) => <Tag key={label}>{label}</Tag>)}</Space></Space>;
    } },
    { title: 'Format', dataIndex: 'format', render: (_, row) => row.format === 'feed_post' ? 'Feed post' : metricLabel(row.format) },
    { title: 'Published', dataIndex: 'published_at', render: (_, row) => <DateTime value={row.published_at} /> },
    { title: 'Primary metric', key: 'metric', render: (_, row) => `${METRIC_LABEL[row.primary_metric]} ${numberText(row.value)}` },
    { title: 'Goal', key: 'goal', render: (_, row) => <StatusTag kind="goal" status={row.goal_result === 'missed' && !row.provisional ? 'missed' : row.goal_result === 'missed' ? 'missed_pending' : row.goal_result} /> },
    { title: 'Vs baseline', dataIndex: 'baseline_ratio', render: (_, row) => row.baseline_ratio ? `${Number(row.baseline_ratio).toFixed(2)}×` : '—' },
    { title: 'Verdict', dataIndex: 'verdict', render: (_, row) => <StatusTag kind="verdict" status={row.verdict} /> },
    { title: 'Checkpoint', key: 'checkpoint', render: (_, row) => <Space>{row.checkpoint}{row.provisional ? <Tag color="warning">Provisional</Tag> : null}</Space> },
  ];
  const appliedPlan = report.applied_plan;

  return (
    <PageContainer
      title={`Report — ${report.plan.week_start} – ${report.plan.week_end}`}
      onBack={() => history.push('/reports')}
      tags={<Space><StatusTag kind="report" status={report.status} />{report.provisional ? <Tag color="warning">Provisional</Tag> : null}</Space>}
      extra={<Space wrap>
        {report.status === 'draft' ? <>
          <DropdownButton disabled={jobRunning} onSelect={(mode) => {
            if (mode === 'full') Modal.confirm({ title: 'Replace the summary and findings?', content: 'Your edits to this report will be lost.', okText: 'Replace', onOk: () => startGenerate('full') });
            else void startGenerate('totals_only');
          }} />
          <Button type="primary" disabled={report.plan.status !== 'closed' || jobRunning} onClick={() => setAcceptOpen(true)}>Accept report</Button>
        </> : appliedPlan ? <>
          <Button onClick={() => history.push(`/plans/${appliedPlan.id}`)}>Open plan — {appliedPlan.title}</Button>
          <Button onClick={() => { void beginApply(appliedPlan.id); }}>Apply again</Button>
        </> : <Tooltip title={findings.some((finding) => finding.accepted) ? undefined : 'Accept at least one finding first'}><Button type="primary" disabled={!findings.some((finding) => finding.accepted) || previewApply.isPending} loading={previewApply.isPending} onClick={() => { void beginApply(); }}>Apply to next plan</Button></Tooltip>}
      </Space>}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {report.plan.status === 'active' ? <Alert type="info" showIcon title="This plan is still active. The report is a preview and cannot be accepted yet." /> : null}
        {report.provisional ? <Alert type="warning" showIcon title={`${totals.posts.provisional} of ${totals.posts.published} posts are younger than their final checkpoint. Numbers may still rise.${totals.provisional_until ? ` Refresh the numbers after ${totals.provisional_until} for final totals.` : ''}`} /> : null}
        {jobRunning || activeJobQuery.data ? <JobProgress job={activeJobQuery.data} title="Weekly report" onDone={() => { void refresh(); }} onFailed={() => { void refresh(); }} /> : null}
        <Card title="Summary" loading={false}>
          {report.status === 'draft' ? <Space direction="vertical" style={{ width: '100%' }}>
            <Input.TextArea value={summary} maxLength={2000} showCount rows={4} onChange={(event) => { setSummary(event.target.value); setSummaryDirty(true); }} />
            <Button type="primary" disabled={!summaryDirty || jobRunning} loading={saveSummary.isPending} onClick={() => saveSummary.mutate()}>Save</Button>
          </Space> : <ContentText preserveLineBreaks>{report.summary || 'No summary was written.'}</ContentText>}
        </Card>
        <Card title="Results">
          <Row gutter={[16, 16]}>
            {metrics.map(([metric, total]) => <Col key={metric} xs={12} sm={8} lg={6}>
              <Statistic title={METRIC_LABEL[metric]} value={total.actual ?? '—'} />
              <Typography.Text type="secondary">{total.goal === null ? 'No goal' : `of ${numberText(total.goal)} · ${total.attainment === null ? '—' : `${Math.round(Number(total.attainment) * 100)}%`}`}</Typography.Text>
              {total.attainment !== null ? <Progress percent={Math.max(0, Math.min(100, Math.round(Number(total.attainment) * 100)))} showInfo={false} status={Number(total.attainment) >= 1 ? 'success' : 'exception'} /> : null}
            </Col>)}
            <Col xs={12} sm={8} lg={6}><Statistic title="Followers" value={totals.follower_change.change ?? '—'} /><Typography.Text type="secondary">{totals.follower_change.goal === null ? 'No goal' : `of ${numberText(totals.follower_change.goal)}`}</Typography.Text></Col>
            <Col xs={12} sm={8} lg={6}><Statistic title="Posts" value={totals.posts.published} /><Typography.Text type="secondary">{totals.posts.published} published · {totals.posts.skipped} skipped</Typography.Text></Col>
          </Row>
          <Space direction="vertical" style={{ width: '100%', marginTop: 16 }}>
            <Segmented value={chartMode} options={[{ label: 'Chart', value: 'chart' }, { label: 'Table', value: 'table' }]} onChange={(value) => setChartMode(value as 'chart' | 'table')} />
            {chartMode === 'chart' ? <Column data={chartData} xField="metric" yField="value" colorField="kind" group /> : <Table rowKey="metric" pagination={false} size="small" dataSource={metrics.map(([metric, total]) => ({ metric, ...total }))} columns={[{ title: 'Metric', dataIndex: 'metric', render: (value: EvaluationMetric) => METRIC_LABEL[value] }, { title: 'Actual', dataIndex: 'actual', render: numberText }, { title: 'Goal', dataIndex: 'goal', render: numberText }, { title: 'Attainment', dataIndex: 'attainment', render: (value: string | null) => value === null ? '—' : `${Math.round(Number(value) * 100)}%` }]} />}
          </Space>
        </Card>
        <Card title="Posts">
          {posts.length ? <Table<ReportPostRow> rowKey="publication" columns={postColumns} dataSource={posts} pagination={false} scroll={{ x: 920 }} /> : <Empty description="No published posts in this report." />}
        </Card>
        {appliedPlan ? <Card title="Applied">
          <Space direction="vertical"><Typography.Text>Applied to <Link to={`/plans/${appliedPlan.id}`}>{appliedPlan.title}</Link> ({appliedPlan.status})</Typography.Text>
            <Space><Tag>Pending {appliedPlan.finding_states.pending}</Tag><Tag color="success">Applied {appliedPlan.finding_states.applied}</Tag><Tag>Ignored {appliedPlan.finding_states.ignored}</Tag></Space>
          </Space>
        </Card> : null}
        <Card title={`Findings · ${report.findings_count.accepted} accepted · ${report.findings_count.undecided} undecided`} extra={report.status === 'draft' ? <Button disabled={actionsDisabled} onClick={() => setFindingDrawer({ open: true, finding: null })}>Add finding</Button> : null}>
          {report.ai_run && !report.summary && findings.length === 0 && totals.posts.published > 0 ? <Result status="warning" title="The findings could not be written. The numbers above are complete." extra={<Space><Button disabled={jobRunning} onClick={() => void startGenerate('full')}>Try again</Button><Button onClick={() => setFindingDrawer({ open: true, finding: null })}>Add finding</Button></Space>} /> : null}
          {findings.length === 0 ? <Empty description="No findings yet." /> : <Space direction="vertical" size={12} style={{ width: '100%' }}>{findings.map((finding) => <FindingItem key={finding.id} finding={finding} disabled={actionsDisabled} appliedState={planFindingState(finding)} onDecision={(value) => decide(finding, value)} onEdit={() => setFindingDrawer({ open: true, finding })} onRemove={() => removeFinding(finding)} posts={posts} />)}</Space>}
          {report.status === 'draft' ? <Space style={{ marginTop: 16 }}><Button disabled={actionsDisabled || undecided === 0} onClick={acceptAll}>Accept all undecided</Button><Typography.Text type="secondary">Every change saves the complete findings list.</Typography.Text></Space> : null}
        </Card>
        <JobProgress job={activeJobQuery.data} variant="inline" />
      </Space>

      <FindingDrawer
        open={findingDrawer.open}
        finding={findingDrawer.finding}
        posts={posts}
        loading={saveFindings.isPending}
        onCancel={() => setFindingDrawer({ open: false, finding: null })}
        onSave={(value) => replaceFindings(findingDrawer.finding
          ? findings.map((item) => item.id === findingDrawer.finding?.id ? { ...item, ...value, id: item.id } : item)
          : [...findings, value])}
      />
      <Modal title="Accept this report?" open={acceptOpen} okText="Accept report" confirmLoading={accept.isPending} onCancel={() => setAcceptOpen(false)} onOk={() => accept.mutate(undecided ? decideRemaining : undefined)}>
        <Space direction="vertical">
          <Typography.Text>Accepted reports cannot be edited.</Typography.Text>
          {report.provisional ? <Alert type="warning" showIcon title="Some numbers are still provisional." /> : null}
          {undecided ? <>
            <Typography.Text>{undecided} findings have no decision. Choose how to resolve them:</Typography.Text>
            <Radio.Group value={decideRemaining} onChange={(event) => setDecideRemaining(event.target.value)} options={[{ value: 'accept', label: `Accept the ${undecided} undecided findings` }, { value: 'dismiss', label: `Dismiss the ${undecided} undecided findings` }]} />
          </> : null}
        </Space>
      </Modal>
      <Modal title="Apply findings to a plan" open={applyOpen} okText="Apply findings" confirmLoading={applyMutation.isPending} onCancel={() => setApplyOpen(false)} onOk={() => applyMutation.mutate(applyPlanChoice)}>
        {applyPreview ? <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text>{applyPreview.accepted_findings} accepted findings will be added as suggestions. Nothing in the plan changes until you apply a suggestion there.</Typography.Text>
          {applyError ? <Alert type="error" showIcon title={applyError} action={<Link to="/plans">Weekly plan</Link>} /> : null}
          <Form layout="vertical"><Form.Item label="Add to">
            <Radio.Group value={applyPlanChoice} onChange={(event) => setApplyPlanChoice(event.target.value === 'default' ? 'default' : Number(event.target.value))}>
              <Space direction="vertical">
                <Radio value="default">{applyPreview.target.will_create ? `A new draft plan for the week of ${applyPreview.target.week_start}${applyPreview.target.duplicate_from ? ` (copied from ${applyPreview.target.duplicate_from.title})` : ''}` : `${applyPreview.target.plan?.title} — ${applyPreview.target.plan?.status}`}</Radio>
                {applyPreview.eligible_plans.filter((plan) => plan.id !== applyPreview.target.plan?.id).map((plan) => <Radio key={plan.id} value={plan.id}>{plan.title} — {plan.status}</Radio>)}
              </Space>
            </Radio.Group>
          </Form.Item></Form>
        </Space> : <Skeleton active />}
      </Modal>
    </PageContainer>
  );
};

const metricLabel = (value: string) => value === 'feed_post' ? 'Feed post' : value.replace(/^\w/, (char) => char.toUpperCase());

const FindingItem: React.FC<{
  finding: ReportFinding;
  disabled: boolean;
  appliedState?: string;
  onDecision: (value: boolean | null) => void;
  onEdit: () => void;
  onRemove: () => void;
  posts: ReportPostRow[];
}> = ({ finding, disabled, appliedState, onDecision, onEdit, onRemove, posts }) => (
  <Card size="small" title={<Space wrap><StatusTag kind="finding" status={finding.type === 'didnt_work' ? 'did_not_work' : finding.type} /><Typography.Text strong>{finding.title}</Typography.Text>{PLAN_FIELD_LABEL[finding.plan_field] ? <Tag>{PLAN_FIELD_LABEL[finding.plan_field]}</Tag> : null}{appliedState ? <StatusTag kind="carried_finding" status={appliedState} label={`${appliedState === 'pending' ? 'Pending' : metricLabel(appliedState)} in plan`} /> : null}</Space>}>
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {finding.detail ? <ContentText as="p">{finding.detail}</ContentText> : null}
      {finding.evidence_publications.length ? <Space wrap><Typography.Text type="secondary">Evidence:</Typography.Text>{finding.evidence_publications.map((publication) => { const post = posts.find((entry) => entry.publication === publication); return <Link key={publication} to={`/analytics/posts/${publication}`}>{post?.title ?? `Post ${publication}`}</Link>; })}</Space> : null}
      <Typography.Paragraph style={{ margin: 0 }}><Typography.Text strong>{finding.recommendation}</Typography.Text></Typography.Paragraph>
      {finding.suggested_change?.metric ? <Typography.Text type="secondary">Suggested goal: {METRIC_LABEL[finding.suggested_change.metric]}, {finding.suggested_change.scope === 'week_total' ? 'week total' : 'per post'}, {finding.suggested_change.format ? metricLabel(finding.suggested_change.format) : 'all formats'}, {numberText(finding.suggested_change.target_value)}</Typography.Text> : null}
      <Space wrap>
        {finding.accepted !== null ? <Button disabled={disabled} type={finding.accepted ? 'primary' : 'default'} onClick={() => onDecision(finding.accepted ? null : true)}>Accept</Button> : <Button disabled={disabled} onClick={() => onDecision(true)}>Accept</Button>}
        {finding.accepted !== null ? <Button disabled={disabled} danger={finding.accepted === false} type={finding.accepted === false ? 'primary' : 'default'} onClick={() => onDecision(finding.accepted === false ? null : false)}>Dismiss</Button> : <Button disabled={disabled} onClick={() => onDecision(false)}>Dismiss</Button>}
        {disabled ? null : <Button type="link" onClick={onEdit}>Edit</Button>}
        {disabled ? null : <Popconfirm title="Remove this finding?" onConfirm={onRemove}><Button type="link" danger>Remove</Button></Popconfirm>}
      </Space>
    </Space>
  </Card>
);

type FindingWrite = Omit<ReportFinding, 'id'> & { id?: string };
const FindingDrawer: React.FC<{
  open: boolean;
  finding: ReportFinding | null;
  posts: ReportPostRow[];
  loading: boolean;
  onCancel: () => void;
  onSave: (finding: FindingWrite) => void;
}> = ({ open, finding, posts, loading, onCancel, onSave }) => {
  const [form] = Form.useForm();
  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(finding ? { ...finding } : { type: 'insight', title: '', detail: '', evidence_publications: [], recommendation: '', plan_field: 'none', suggested_change: { note: '' }, accepted: null });
  }, [open, finding?.id]);
  const submit = (values: any) => onSave({
    ...(finding ? { id: finding.id } : {}),
    ...values,
    suggested_change: values.suggested_change?.metric ? values.suggested_change : { note: values.suggested_change?.note ?? '' },
    accepted: finding?.accepted ?? null,
  });
  return <Drawer title={finding ? 'Edit finding' : 'Add finding'} open={open} width={560} onClose={onCancel} extra={<Space><Button onClick={onCancel}>Cancel</Button><Button type="primary" loading={loading} onClick={() => form.submit()}>Save</Button></Space>}>
    <Form form={form} layout="vertical" onFinish={submit}>
      <Form.Item name="type" label="Type" rules={[{ required: true }]}><Select options={[{ value: 'worked', label: 'Worked' }, { value: 'didnt_work', label: 'Did not work' }, { value: 'insight', label: 'Insight' }]} /></Form.Item>
      <Form.Item name="title" label="Title" rules={[{ required: true, max: 120 }]}><Input maxLength={120} showCount /></Form.Item>
      <Form.Item name="detail" label="What the numbers show" rules={[{ max: 800 }]}><Input.TextArea dir="auto" rows={4} maxLength={800} showCount /></Form.Item>
      <Form.Item name="evidence_publications" label="Evidence posts" rules={[{ required: true }]}><Select mode="multiple" options={posts.map((post) => ({ value: post.publication, label: post.title }))} /></Form.Item>
      <Form.Item name="recommendation" label="Recommendation" rules={[{ required: true, max: 400 }]}><Input.TextArea dir="auto" rows={3} maxLength={400} showCount /></Form.Item>
      <Form.Item name="plan_field" label="Plan field" rules={[{ required: true }]}><Select options={Object.entries(PLAN_FIELD_LABEL).map(([value, label]) => ({ value, label: label || 'None' }))} /></Form.Item>
      <Form.Item name={['suggested_change', 'note']} label="Suggested change" rules={[{ required: true, max: 300 }]}><Input.TextArea dir="auto" maxLength={300} showCount rows={2} /></Form.Item>
      <Form.Item noStyle shouldUpdate={(previous, current) => previous.plan_field !== current.plan_field}>{({ getFieldValue }) => getFieldValue('plan_field') === 'goals' ? <>
        <Form.Item name={['suggested_change', 'metric']} label="Metric" rules={[{ required: true }]}><Select options={Object.keys(METRIC_LABEL).map((value) => ({ value, label: METRIC_LABEL[value as EvaluationMetric] }))} /></Form.Item>
        <Form.Item name={['suggested_change', 'scope']} label="Scope" rules={[{ required: true }]}><Select options={[{ value: 'week_total', label: 'Week total' }, { value: 'per_post', label: 'Per post' }]} /></Form.Item>
        <Form.Item name={['suggested_change', 'format']} label="Format"><Select allowClear options={[{ value: 'reel', label: 'Reel' }, { value: 'story', label: 'Story' }, { value: 'feed_post', label: 'Feed post' }]} /></Form.Item>
        <Form.Item name={['suggested_change', 'target_value']} label="Target" rules={[{ required: true, type: 'number', min: 1 }]}><Input type="number" /></Form.Item>
      </> : null}</Form.Item>
    </Form>
  </Drawer>;
};

const DropdownButton: React.FC<{ disabled?: boolean; onSelect: (mode: 'full' | 'totals_only') => void }> = ({ disabled, onSelect }) => {
  const [open, setOpen] = useState(false);
  return <Space>
    <Button disabled={disabled} onClick={() => setOpen(true)}>Regenerate</Button>
    <Modal title="Regenerate report" open={open} onCancel={() => setOpen(false)} footer={null}>
      <Space direction="vertical"><Button block onClick={() => { setOpen(false); onSelect('full'); }}>Replace summary and findings</Button><Button block onClick={() => { setOpen(false); onSelect('totals_only'); }}>Refresh numbers only</Button></Space>
    </Modal>
  </Space>;
};

export default ReportPage;
