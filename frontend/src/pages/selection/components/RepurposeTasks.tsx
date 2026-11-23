import { ProCard, ProTable, type ProColumns } from '@ant-design/pro-components';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from '@umijs/max';
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import dayjs from 'dayjs';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import ContentText from '@/components/ContentText';
import DateTime from '@/components/DateTime';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import type { Format } from '@/services/socialhub/formats';
import { listPlans } from '@/services/socialhub/plans';
import { listJobs } from '@/services/socialhub/jobs';
import { listRepurposeTasks, updateRepurposeTask, type RepurposeStatus, type RepurposeTask } from '@/services/socialhub/repurpose';
import { accountQueryKey } from '@/utils/accountRequest';
import { isApiError } from '@/services/socialhub/http';
import { notifyError } from '@/utils/errorText';
import { rankResultText } from '../logic';
import { startRanking } from '@/services/socialhub/selection';
import JobButton from '@/components/JobButton';
import { useActiveJob } from '@/hooks/useJob';

type Props = {
  accountId: number;
  readOnly: boolean;
  rankRunning: boolean;
  onChanged: () => void;
  planId?: number;
};
const ACTIVE: RepurposeStatus[] = ['open', 'in_selection'];

const RepurposeTasks: React.FC<Props> = ({ accountId, readOnly, rankRunning, onChanged, planId }) => {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [filter, setFilter] = useState<'active' | 'used' | 'dismissed'>('active');
  const [expanded, setExpanded] = useState(searchParams.get('repurpose') === '1');
  const [needsRerank, setNeedsRerank] = useState(false);
  const [editTask, setEditTask] = useState<RepurposeTask | null>(null);
  const [dismissTask, setDismissTask] = useState<RepurposeTask | null>(null);
  const [form] = Form.useForm<{ suggested_angle: string; suggested_formats: Format[] }>();
  const [dismissForm] = Form.useForm<{ dismiss_reason?: string }>();
  const listKey = accountQueryKey(accountId, 'repurpose-tasks', filter);
  const status: RepurposeStatus[] = filter === 'active' ? ACTIVE : [filter];
  const query = useQuery({
    queryKey: listKey,
    queryFn: () => listRepurposeTasks({ account: accountId, status, ordering: '-created_at', page_size: 100 }),
    refetchInterval: (current) => current.state.data?.results.some((task) => task.active_job && ['queued', 'running'].includes(task.active_job.status)) ? 3000 : false,
  });
  const plansQuery = useQuery({ queryKey: accountQueryKey(accountId, 'repurpose-plan-labels'), queryFn: () => listPlans({ account: accountId, status: ['draft', 'active', 'closed'] }) });
  const tasks = query.data?.results ?? [];
  const activeCountQuery = useQuery({
    queryKey: accountQueryKey(accountId, 'repurpose-task-count'),
    queryFn: () => listRepurposeTasks({ account: accountId, status: ACTIVE, page_size: 1 }),
  });
  const suggestionJobsQuery = useQuery({
    queryKey: accountQueryKey(accountId, 'repurpose-suggestion-jobs'),
    queryFn: () => listJobs({ account: accountId, kind: ['repurpose.suggest'], status: ['queued', 'running'], page_size: 100 }),
    refetchInterval: (current) => current.state.data?.results.length ? 3000 : false,
  });
  const activeCount = activeCountQuery.data?.count ?? 0;
  const previousActiveCount = useRef(activeCount);
  useEffect(() => {
    if (previousActiveCount.current !== activeCount && activeCount > 0) setNeedsRerank(true);
    previousActiveCount.current = activeCount;
  }, [activeCount]);
  useEffect(() => { if (activeCount > 0) setExpanded(true); }, [activeCount]);
  const activeRankJob = useActiveJob({ account: accountId, kinds: ['selection.rank'], targetType: 'plan', targetId: planId ? String(planId) : undefined });
  const planLabels = useMemo(() => new Map((plansQuery.data?.results ?? []).map((plan) => [plan.id, plan.title])), [plansQuery.data]);
  const suggestionTargets = useMemo(() => new Set((suggestionJobsQuery.data?.results ?? []).map((job) => job.target_id)), [suggestionJobsQuery.data]);
  const invalidate = async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: accountQueryKey(accountId, 'repurpose-tasks') }),
    queryClient.invalidateQueries({ queryKey: [accountId, 'candidates'] }),
  ]);
  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Parameters<typeof updateRepurposeTask>[1] }) => updateRepurposeTask(id, body),
    onSuccess: async () => { setEditTask(null); setDismissTask(null); setNeedsRerank(true); await invalidate(); onChanged(); message.success('Repurpose task updated. Rank candidates again to refresh the list.'); },
    onError: (error) => {
      if (isApiError(error) && error.status === 409) { message.warning('This task changed. Reloading.'); void query.refetch(); }
      else notifyError(error);
    },
  });

  const beginEdit = (task: RepurposeTask) => { setEditTask(task); form.setFieldsValue({ suggested_angle: task.suggested_angle, suggested_formats: task.suggested_formats }); };
  const saveEdit = (values: { suggested_angle: string; suggested_formats: Format[] }) => {
    if (!editTask) return;
    update.mutate({ id: editTask.id, body: { suggested_angle: values.suggested_angle, suggested_formats: values.suggested_formats } });
  };
  const columns: ProColumns<RepurposeTask>[] = [
    { title: 'Post', key: 'post', render: (_, task) => <Space direction="vertical" size={2}><Link to={`/analytics/posts/${task.source_publication.id}`}><ContentText strong>{task.source_publication.title}</ContentText></Link><Space><Tag>{task.source_publication.format === 'feed_post' ? 'Feed post' : task.source_publication.format}</Tag><DateTime value={task.source_publication.published_at} format="date" /></Space></Space> },
    { title: 'Why', dataIndex: 'reason', render: (_, task) => <ContentText>{task.reason || '—'}</ContentText> },
    { title: 'Suggested angle', dataIndex: 'suggested_angle', render: (_, task) => (task.active_job && ['queued', 'running'].includes(task.active_job.status)) || suggestionTargets.has(String(task.id)) ? <Space><Spin size="small" /><Typography.Text type="secondary">Writing a suggestion…</Typography.Text></Space> : task.suggested_angle ? <ContentText>{task.suggested_angle}</ContentText> : <Typography.Text type="secondary">No suggestion yet</Typography.Text> },
    { title: 'Formats', dataIndex: 'suggested_formats', render: (_, task) => <Space wrap>{task.suggested_formats.map((format) => <Tag key={format}>{format === 'feed_post' ? 'Feed post' : format}</Tag>)}</Space> },
    { title: 'Evidence', dataIndex: 'evidence_score', render: (_, task) => <Tooltip title="Used as the evidence score when candidates are ranked">{task.evidence_score}</Tooltip> },
    { title: 'Status', dataIndex: 'status', render: (_, task) => <Space direction="vertical" size={2}><StatusTag kind="repurpose" status={task.status} />{task.status === 'in_selection' && task.candidate ? <Typography.Text type="secondary">Rank {task.candidate.rank ?? '—'} in {planLabels.get(task.candidate.plan) ?? `plan ${task.candidate.plan}`}</Typography.Text> : null}{task.status === 'used' && task.content_item ? <Link to={`/content/${task.content_item}`}>Open item</Link> : null}</Space> },
    { title: 'Expires', dataIndex: 'expires_at', render: (_, task) => { const days = dayjs(task.expires_at).diff(dayjs(), 'day'); return <Typography.Text type={days <= 5 && task.status !== 'used' && task.status !== 'dismissed' ? 'warning' : undefined}><DateTime value={task.expires_at} format="relative" /></Typography.Text>; } },
    { title: 'Actions', valueType: 'option', render: (_, task) => {
      if (readOnly || task.status === 'used') return [];
      if (task.status === 'dismissed') return [<Button key="reopen" type="link" onClick={() => update.mutate({ id: task.id, body: { status: 'open' } })}>Reopen</Button>];
      return [<Button key="edit" type="link" onClick={() => beginEdit(task)}>Edit</Button>, <Button key="dismiss" type="link" danger onClick={() => { setDismissTask(task); dismissForm.resetFields(); }}>Dismiss</Button>];
    } },
  ];

  const title = <Space><span>Repurpose tasks</span><Tag>{activeCount}</Tag></Space>;
  return <ProCard title={title} headerBordered extra={<Button type="text" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>{expanded ? 'Collapse' : 'Expand'}</Button>}>
    {expanded ? <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Segmented value={filter} options={[{ value: 'active', label: `Active (${activeCount})` }, { value: 'used', label: 'Used' }, { value: 'dismissed', label: 'Dismissed' }]} onChange={(value) => setFilter(value as typeof filter)} />
      {query.error ? <PageError error={query.error} onRetry={() => { void query.refetch(); }} /> : null}
      <ProTable<RepurposeTask> rowKey="id" size="small" columns={columns} dataSource={tasks} loading={query.isPending || query.isFetching} search={false} options={false} headerTitle={false} toolBarRender={false} pagination={{ pageSize: 10, showSizeChanger: false }} locale={{ emptyText: 'No repurpose tasks. Posts that clearly beat their baseline appear here after their final evaluation.' }} scroll={{ x: 1150 }} />
      {needsRerank && activeCount > 0 ? <Alert type="info" showIcon title={<Space wrap><span>Repurpose tasks changed. Rank candidates again to update the list.</span><JobButton type="primary" disabled={readOnly || rankRunning || !planId} start={() => startRanking(planId as number)} activeJob={activeRankJob.data} kinds={['selection.rank']} onStarted={() => { void activeRankJob.refetch(); }} onDone={() => { setNeedsRerank(false); void activeRankJob.refetch(); onChanged(); }} successMessage={(job) => rankResultText(job.result)}>Rank candidates</JobButton></Space>} /> : null}
    </Space> : null}
    <Modal title="Edit repurpose task" open={Boolean(editTask)} okText="Save" confirmLoading={update.isPending} onCancel={() => setEditTask(null)} onOk={() => form.submit()} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={saveEdit}>
        <Form.Item name="suggested_angle" label="Suggested angle"><Input.TextArea dir="auto" maxLength={600} showCount rows={4} /></Form.Item>
        <Form.Item name="suggested_formats" label="Formats" rules={[{ required: true }, { type: 'array', min: 1, max: 2 }]}><Select mode="multiple" maxCount={2} options={[{ value: 'reel', label: 'Reel' }, { value: 'feed_post', label: 'Feed post' }, { value: 'story', label: 'Story' }]} /></Form.Item>
      </Form>
    </Modal>
    <Modal title="Dismiss this task? It will be removed from ranking." open={Boolean(dismissTask)} okText="Dismiss task" okButtonProps={{ danger: true }} confirmLoading={update.isPending} onCancel={() => setDismissTask(null)} onOk={() => dismissForm.submit()} destroyOnHidden>
      <Form form={dismissForm} layout="vertical" onFinish={(values: { dismiss_reason?: string }) => dismissTask && update.mutate({ id: dismissTask.id, body: { status: 'dismissed', dismiss_reason: values.dismiss_reason?.trim() ?? '' } })}>
        <Form.Item name="dismiss_reason" label="Reason (optional)"><Input.TextArea maxLength={500} showCount rows={3} /></Form.Item>
      </Form>
    </Modal>
  </ProCard>;
};

export default RepurposeTasks;
