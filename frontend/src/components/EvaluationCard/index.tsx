import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@umijs/max';
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Segmented,
  Space,
  Table,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useMemo, useState } from 'react';
import DateTime from '@/components/DateTime';
import JobButton from '@/components/JobButton';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import { useActiveJob } from '@/hooks/useJob';
import type { AnalyticsCheckpoint } from '@/services/socialhub/analytics';
import type { Format } from '@/services/socialhub/formats';
import {
  listEvaluations,
  getEvaluation,
  runEvaluations,
  type EvaluationCheckpoint,
  type EvaluationDetail,
  type EvaluationMetric,
  type EvaluationMetricRow,
} from '@/services/socialhub/evaluations';
import { createRepurposeTask, listRepurposeTasks } from '@/services/socialhub/repurpose';
import { accountQueryKey } from '@/utils/accountRequest';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { notifyError } from '@/utils/errorText';

const METRICS: EvaluationMetric[] = ['reach', 'views', 'likes', 'comments', 'saves', 'shares', 'replies'];
const METRIC_LABEL: Record<EvaluationMetric, string> = {
  reach: 'Reach', views: 'Views', likes: 'Likes', comments: 'Comments',
  saves: 'Saves', shares: 'Shares', replies: 'Replies',
};
const FORMAT_LABEL: Record<Format, string> = { reel: 'reel', feed_post: 'feed post', story: 'story' };
const DEFAULT_FORMATS: Record<Format, Format[]> = {
  reel: ['feed_post', 'story'], feed_post: ['reel', 'story'], story: ['reel', 'feed_post'],
};
const numberText = (value: number | string | null | undefined) =>
  value === null || value === undefined ? '—' : Number(value).toLocaleString('en-US');
const ratioText = (value: string | number | null) => value === null ? '—' : `${Number(value).toFixed(2)}×`;

type Props = {
  accountId: number;
  publicationId: number;
  title: string;
  format: Format;
  checkpoints: AnalyticsCheckpoint[];
  onEnterManual?: (checkpoint: string) => void;
};

const EvaluationCard: React.FC<Props> = ({ accountId, publicationId, title, format, checkpoints, onEnterManual }) => {
  const queryClient = useQueryClient();
  const defaultCheckpoint: EvaluationCheckpoint = format === 'story' ? '23h' : '7d';
  const [checkpoint, setCheckpoint] = useState<EvaluationCheckpoint>(defaultCheckpoint);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm<{ reason?: string; suggested_angle?: string; suggested_formats: Format[] }>();
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const evaluationsKey = accountQueryKey(accountId, 'evaluations', publicationId);
  const evaluationsQuery = useQuery({
    queryKey: evaluationsKey,
    queryFn: () => listEvaluations({ account: accountId, publication: publicationId, ordering: '-evaluated_at', page_size: 20 }),
  });
  const rows = evaluationsQuery.data?.results ?? [];
  const available = useMemo(() => {
    const all = format === 'story' ? ['23h'] : ['24h', '7d'];
    return all.map((value) => ({ label: value === '23h' ? '23 h' : value === '24h' ? '24 h' : '7 d', value }));
  }, [format]);
  const selectedRow = rows.find((row) => row.checkpoint === checkpoint) ?? null;
  const detailQuery = useQuery({
    queryKey: accountQueryKey(accountId, 'evaluation', selectedRow?.id),
    queryFn: () => {
      const evaluationId = selectedRow?.id;
      if (evaluationId === undefined) return Promise.reject(new Error('Choose an evaluation checkpoint first.'));
      return getEvaluation(evaluationId);
    },
    enabled: Boolean(selectedRow),
  });
  const activeJobQuery = useActiveJob({ account: accountId, kinds: ['evaluation.run'], targetType: 'publication', targetId: String(publicationId) });
  const openTaskQuery = useQuery({
    queryKey: accountQueryKey(accountId, 'repurpose-for-publication', publicationId),
    queryFn: () => listRepurposeTasks({ account: accountId, source_publication: publicationId, status: ['open', 'in_selection'], page_size: 1 }),
  });
  const taskMutation = useMutation({
    mutationFn: (values: { reason?: string; suggested_angle?: string; suggested_formats: Format[] }) => createRepurposeTask({
      source_publication: publicationId,
      reason: values.reason?.trim() || undefined,
      suggested_angle: values.suggested_angle?.trim() || undefined,
      suggested_formats: values.suggested_formats,
    }),
    onSuccess: async () => {
      message.success('Repurpose task created. It will appear in the next ranking.');
      setCreateOpen(false);
      form.resetFields();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: accountQueryKey(accountId, 'repurpose-tasks') }),
        queryClient.invalidateQueries({ queryKey: accountQueryKey(accountId, 'repurpose-for-publication', publicationId) }),
      ]);
    },
    onError: (error) => {
      if (taskMutationErrorIsUnique(error)) setFieldErrors(['This post already has an open repurpose task.']);
      else if (typeof error === 'object' && error !== null && 'fields' in error) {
        const unmatched = applyFieldErrors(form, error);
        if (unmatched.length) setFieldErrors(unmatched);
      } else notifyError(error);
      void openTaskQuery.refetch();
    },
  });

  const startEvaluation = () => runEvaluations({ account: accountId, publication: publicationId, force: true });
  const evaluation = detailQuery.data;
  const checkpointInfo = checkpoints.find((entry) => entry.checkpoint === checkpoint);
  const noEvaluationText = checkpointInfo?.snapshot
    ? 'Metrics were captured. Run an evaluation to compare this post with its goal and similar posts.'
    : checkpointInfo?.status === 'upcoming' || checkpointInfo?.status === 'due'
      ? `This post will be evaluated when its ${checkpoint === '23h' ? '23 h' : checkpoint === '24h' ? '24 h' : '7 d'} metrics arrive.`
      : `No ${checkpoint === '23h' ? '23 h' : checkpoint === '24h' ? '24 h' : '7 d'} metrics were captured for this post.`;
  const hasOpenTask = (openTaskQuery.data?.results.length ?? 0) > 0;

  const metricColumns: ColumnsType<EvaluationMetricRow & { metric: EvaluationMetric }> = [
    { title: 'Metric', dataIndex: 'metric', render: (_, row) => <Space><span>{METRIC_LABEL[row.metric]}</span>{row.metric === evaluation?.primary_metric ? <TagPrimary /> : null}</Space> },
    { title: 'Value', dataIndex: 'value', render: (_, row) => row.unavailable ? <Typography.Text type="secondary">Not available</Typography.Text> : numberText(row.value) },
    { title: 'Baseline', dataIndex: 'baseline', render: (_, row) => numberText(row.baseline) },
    { title: 'Ratio', dataIndex: 'ratio', render: (_, row) => ratioText(row.ratio) },
    { title: 'Goal', dataIndex: 'goal', render: (_, row) => numberText(row.goal) },
    { title: 'Samples', dataIndex: 'sample_size', render: (_, row) => row.sample_size.toLocaleString('en-US') },
  ];

  const openCreate = () => {
    form.setFieldsValue({ reason: '', suggested_angle: '', suggested_formats: DEFAULT_FORMATS[format] });
    setFieldErrors([]);
    setCreateOpen(true);
  };

  return (
    <Card
      title="Evaluation"
      extra={<Space wrap>
        {hasOpenTask ? <Link to="/selection?tab=candidates&repurpose=1">Repurpose task open</Link> : <Button onClick={openCreate}>Create repurpose task</Button>}
        <JobButton type="primary" start={startEvaluation} activeJob={activeJobQuery.data} kinds={['evaluation.run']} onStarted={() => { void activeJobQuery.refetch(); }} onDone={() => { void queryClient.invalidateQueries({ queryKey: evaluationsKey }); }} onFailed={() => { void queryClient.invalidateQueries({ queryKey: evaluationsKey }); }} successMessage="Evaluation updated">Evaluate now</JobButton>
      </Space>}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {evaluation?.repurpose_task && evaluation.is_final && evaluation.verdict === 'outperforming' ? (
          <Alert type="success" showIcon title={<span>A repurpose task was created automatically. <Link to="/selection?tab=candidates&repurpose=1">Open repurpose tasks</Link></span>} />
        ) : null}
        <Space wrap>
          <Typography.Text strong>Checkpoint</Typography.Text>
          <Segmented options={available} value={checkpoint} onChange={(value) => setCheckpoint(value as EvaluationCheckpoint)} />
          {checkpointInfo?.snapshot?.captured_at ? <Typography.Text type="secondary">Captured <DateTime value={checkpointInfo.snapshot.captured_at} /></Typography.Text> : null}
        </Space>
        {evaluationsQuery.isPending ? <Card loading /> : null}
        {evaluationsQuery.error ? <PageError error={evaluationsQuery.error} onRetry={() => { void evaluationsQuery.refetch(); }} /> : null}
        {!evaluationsQuery.error && !selectedRow && !evaluationsQuery.isPending ? (
          <Empty description={<Space direction="vertical"><span>{noEvaluationText}</span>{checkpointInfo && checkpointInfo.status !== 'upcoming' && onEnterManual ? <Button type="link" onClick={() => onEnterManual(checkpoint)}>Enter metrics</Button> : null}{checkpointInfo?.target_at ? <Typography.Text type="secondary">Expected <DateTime value={checkpointInfo.target_at} /></Typography.Text> : null}</Space>} />
        ) : null}
        {selectedRow && detailQuery.isError ? <PageError error={detailQuery.error} onRetry={() => { void detailQuery.refetch(); }} /> : null}
        {selectedRow && (detailQuery.isPending || !evaluation) ? <Card loading /> : null}
        {evaluation ? <EvaluationDetailView evaluation={evaluation} format={format} unavailableMetrics={(checkpointInfo?.snapshot?.unavailable ?? []).filter((metric): metric is EvaluationMetric => metric !== 'follower_growth')} columns={metricColumns} /> : null}
      </Space>
      <Modal
        title="Create repurpose task"
        open={createOpen}
        okText="Create task"
        confirmLoading={taskMutation.isPending}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        destroyOnHidden
      >
        {fieldErrors.length ? <Alert type="error" showIcon title={fieldErrors.join(' ')} style={{ marginBottom: 16 }} /> : null}
        <Form form={form} layout="vertical" onFinish={(values) => taskMutation.mutate(values)} onValuesChange={() => setFieldErrors([])}>
          <Form.Item name="reason" label="Reason"><Input.TextArea maxLength={500} showCount rows={2} placeholder="Optional context for why this post should be reused." /></Form.Item>
          <Form.Item name="suggested_angle" label="Suggested angle" extra="Leave empty to get a suggestion."><Input.TextArea dir="auto" maxLength={600} showCount rows={3} /></Form.Item>
          <Form.Item name="suggested_formats" label="Formats" rules={[{ required: true, message: 'Choose at least one format.' }]}>
            <Select mode="multiple" maxCount={2} options={(['reel', 'feed_post', 'story'] as Format[]).filter((value) => value !== format).map((value) => ({ value, label: value === 'feed_post' ? 'Feed post' : value[0].toUpperCase() + value.slice(1) }))} />
          </Form.Item>
          <Typography.Text type="secondary">Source post: {title}</Typography.Text>
        </Form>
      </Modal>
    </Card>
  );
};

const EvaluationDetailView: React.FC<{
  evaluation: EvaluationDetail;
  format: Format;
  unavailableMetrics: EvaluationMetric[];
  columns: ColumnsType<EvaluationMetricRow & { metric: EvaluationMetric }>;
}> = ({ evaluation, format, unavailableMetrics, columns }) => {
  const value = numberText(evaluation.value);
  const metric = METRIC_LABEL[evaluation.primary_metric];
  const checkpoint = evaluation.checkpoint === '23h' ? '23 h' : evaluation.checkpoint === '24h' ? '24 h' : '7 d';
  const ratio = evaluation.baseline_ratio === null ? null : Number(evaluation.baseline_ratio);
  const sentence = evaluation.value === null
    ? `${metric} were not available at ${checkpoint}.`
    : ratio !== null
      ? `${metric} ${value} at ${checkpoint} — ${ratio.toFixed(2)}× the median of ${evaluation.baseline_sample_size} similar ${FORMAT_LABEL[format]}${evaluation.baseline_sample_size === 1 ? '' : 's'} (${numberText(evaluation.baseline_value)}).`
      : evaluation.baseline_sample_size < 5
        ? `${metric} ${value} at ${checkpoint} — only ${evaluation.baseline_sample_size} similar ${FORMAT_LABEL[format]}${evaluation.baseline_sample_size === 1 ? '' : 's'} in the last 60 days; 5 are needed for a comparison.`
        : `${metric} ${value} at ${checkpoint} — a baseline comparison is unavailable.`;
  const goalStatus = evaluation.goal_result === 'missed' && !evaluation.is_final ? 'missed_pending' : evaluation.goal_result;
  const metricRows = METRICS.map((metricKey) => ({ metric: metricKey, ...evaluation.metrics[metricKey], unavailable: unavailableMetrics.includes(metricKey) }));
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space wrap align="center">
        <StatusTag kind="verdict" status={evaluation.verdict} />
        <Typography.Text>{sentence}</Typography.Text>
      </Space>
      <Space wrap>
        <StatusTag kind="goal" status={goalStatus} />
        {evaluation.goal_target !== null ? <Typography.Text>{numberText(evaluation.value)} of {numberText(evaluation.goal_target)}</Typography.Text> : null}
        {evaluation.goal_source === 'week_total_share' ? <Tooltip title="This per-post goal is a share of the plan's weekly goal."><Typography.Text type="secondary">Share of weekly goal</Typography.Text></Tooltip> : null}
        <Typography.Text type="secondary">Evaluated <DateTime value={evaluation.evaluated_at} /></Typography.Text>
      </Space>
      <Table<EvaluationMetricRow & { metric: EvaluationMetric }>
        rowKey="metric"
        size="small"
        pagination={false}
        columns={columns}
        dataSource={metricRows}
        scroll={{ x: 680 }}
      />
      {evaluation.baseline_samples.length ? (
        <details>
          <summary>Compared with {evaluation.baseline_samples.length} similar posts</summary>
          <ul>{evaluation.baseline_samples.map((sample) => <li key={sample.publication}><Link to={`/analytics/posts/${sample.publication}`}>Post {sample.publication}</Link> — {numberText(sample.value)}</li>)}</ul>
        </details>
      ) : null}
    </Space>
  );
};

const TagPrimary = () => <Typography.Text type="secondary" style={{ fontSize: 12 }}>Primary</Typography.Text>;

function taskMutationErrorIsUnique(error: unknown) {
  return typeof error === 'object' && error !== null && 'fields' in error &&
    Array.isArray((error as { fields?: unknown }).fields) &&
    (error as { fields: { code?: string }[] }).fields.some((field) => field.code === 'unique');
}

export default EvaluationCard;
