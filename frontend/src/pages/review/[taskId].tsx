import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '@ant-design/pro-components';
import { history, useModel, useParams } from '@umijs/max';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Radio,
  Result,
  Select,
  Skeleton,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import React, { useEffect, useMemo, useState } from 'react';
import AccountGate from '@/components/AccountGate';
import ContentText from '@/components/ContentText';
import DateTime from '@/components/DateTime';
import JobButton from '@/components/JobButton';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import MediaPreview from '@/pages/content/shared/MediaPreview';
import CheckCard from '@/components/quality/CheckCard';
import { type PlanSlot, listPlanSlots } from '@/services/socialhub/content';
import { isApiError } from '@/services/socialhub/http';
import {
  getReviewTask,
  resolveReviewTask,
  startCheckRun,
  type ReviewDecision,
  type ReviewTaskDetail,
  type ResolveReviewBody,
} from '@/services/socialhub/quality';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { accountQueryKey, useCurrentAccount } from '@/utils/accountRequest';
import { notifyError } from '@/utils/errorText';

dayjs.extend(utc);
dayjs.extend(timezone);

type DecisionForm = {
  decision: ReviewDecision;
  decision_note?: string;
  instructions?: string;
  rework?: 'copy' | 'script' | 'manual';
  release_candidate?: boolean;
  approve_time_mode?: 'time' | 'slot';
  scheduled_at?: Dayjs;
  slot?: number;
};

const TaskMedia: React.FC<{ task: ReviewTaskDetail }> = ({ task }) => {
  return (
    <Card title={`Version ${task.version.version}`}>
      {task.version.final_asset ? <MediaPreview asset={task.version.final_asset} cover={task.version.cover_asset} format={task.item.format} alt={task.version.alt_text || task.item.title} maxHeight={520} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No final media is attached to this version." />}
      {task.version.frames.length ? <Space wrap style={{ marginTop: 12 }}>{task.version.frames.map((frame) => <img key={frame.index} src={frame.url} alt={`Frame ${frame.index}`} style={{ width: 92, height: 120, objectFit: 'cover', borderRadius: 4 }} />)}</Space> : null}
    </Card>
  );
};

const DiffCard: React.FC<{ task: ReviewTaskDetail }> = ({ task }) => {
  if (!task.diff) return <Card title="Version history"><Typography.Text type="secondary">This is the first version submitted for review.</Typography.Text></Card>;
  const diff = task.diff;
  return (
    <Card title="Changes since the previous version">
      <Space direction="vertical" style={{ width: '100%' }}>
        {diff.change_note ? <Typography.Text>{diff.change_note}</Typography.Text> : null}
        {diff.caption?.changed ? <Descriptions size="small" column={1} items={[{ key: 'before', label: 'Previous caption', children: <ContentText preserveLineBreaks>{diff.caption.before}</ContentText> }, { key: 'after', label: 'Current caption', children: <ContentText preserveLineBreaks>{diff.caption.after}</ContentText> }]} /> : <Typography.Text type="secondary">Caption unchanged.</Typography.Text>}
        {diff.hashtags ? <Typography.Text>Hashtags added: {diff.hashtags.added.join(', ') || 'none'} · removed: {diff.hashtags.removed.join(', ') || 'none'}</Typography.Text> : null}
        {diff.alt_text?.changed ? <Typography.Text>Alt text changed.</Typography.Text> : null}
        {diff.final_asset?.changed ? <Typography.Text>Final asset changed.</Typography.Text> : null}
        {diff.cover_asset?.changed ? <Typography.Text>Cover asset changed.</Typography.Text> : null}
        {diff.frames_changed?.length ? <Typography.Text>Frames changed: {diff.frames_changed.join(', ')}</Typography.Text> : null}
        {diff.script_version ? <Typography.Text>Script version: {diff.script_version.before ?? '—'} → {diff.script_version.after ?? '—'}</Typography.Text> : null}
      </Space>
    </Card>
  );
};

const TaskReview: React.FC<{ taskId: string }> = ({ taskId }) => {
  const { currentAccount: account, setCurrentAccount } = useModel('account');
  const { accountId } = useCurrentAccount();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<DecisionForm>();
  const [fieldMessages, setFieldMessages] = useState<string[]>([]);
  const decision = Form.useWatch('decision', form) ?? 'approve';
  const timeMode = Form.useWatch('approve_time_mode', form) ?? 'time';
  const taskQuery = useQuery({
    queryKey: accountQueryKey(accountId, 'review-task', taskId),
    enabled: /^\d+$/.test(taskId) && accountId !== null,
    queryFn: () => getReviewTask(taskId),
  });
  const task = taskQuery.data;
  const openSlotsQuery = useQuery({
    queryKey: accountQueryKey(accountId, 'review-open-slots', task?.item.plan),
    enabled: Boolean(task?.reason === 'no_slot' && task.item.plan),
    queryFn: () => {
      const current = task;
      const planId = current?.item.plan;
      if (!current || !planId) return Promise.reject(new Error('This review task has no plan.'));
      return listPlanSlots(planId, { status: ['open'], format: [current.item.format] });
    },
  });
  const availableSlots = useMemo(() => openSlotsQuery.data?.results ?? [], [openSlotsQuery.data]);
  const decisionState = task?.decisions[decision];

  useEffect(() => {
    if (task && account && task.account !== account.id) {
      setCurrentAccount(task.account);
    }
  }, [task?.account, account?.id]);

  const mutation = useMutation({
    mutationFn: (body: ResolveReviewBody) => resolveReviewTask(taskId, body),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: accountQueryKey(task?.account ?? accountId, 'review-tasks') }),
        queryClient.invalidateQueries({ queryKey: accountQueryKey(task?.account ?? accountId, 'review-count') }),
        queryClient.invalidateQueries({ queryKey: ['content-item', String(task?.item.id)] }),
      ]);
      message.success('Review decision saved');
      if (result.next_open_task_id) history.replace(`/review/${result.next_open_task_id}`);
      else if (result.job) history.replace(`/content/${task?.item.id}?tab=production`);
      else history.replace('/review');
    },
    onError: (error) => {
      if (isApiError(error) && error.fields.length) {
        setFieldMessages(applyFieldErrors(form, error));
      } else {
        notifyError(error);
      }
      if (isApiError(error) && error.status === 409) void taskQuery.refetch();
    },
  });

  const buildBody = (values: DecisionForm): ResolveReviewBody => {
    if (values.decision === 'approve') {
      if (task?.reason === 'no_slot') {
        if (values.approve_time_mode === 'slot' && values.slot) return { decision: 'approve', slot: values.slot };
        const zone = account?.timezone ?? 'UTC';
        const localValue = values.scheduled_at?.format('YYYY-MM-DD HH:mm');
        return { decision: 'approve', scheduled_at: localValue ? dayjs.tz(localValue, zone).utc().toISOString() : undefined };
      }
      return { decision: 'approve', decision_note: values.decision_note?.trim() || undefined };
    }
    if (values.decision === 'request_changes') {
      return { decision: 'request_changes', rework: values.rework ?? 'manual', instructions: values.instructions?.trim() ?? '' };
    }
    return { decision: 'reject', decision_note: values.decision_note?.trim() ?? '', release_candidate: Boolean(values.release_candidate) };
  };

  const submit = async (values: DecisionForm) => {
    if (!task) return;
    const body = buildBody(values);
    const run = () => mutation.mutate(body);
    if (values.decision === 'reject') {
      Modal.confirm({ title: 'Reject this item?', content: 'The item will be cancelled and its slot released.', okText: 'Reject item', okButtonProps: { danger: true }, onOk: run });
    } else {
      run();
    }
  };

  if (!/^\d+$/.test(taskId)) return <PageContainer title="Review task"><Result status="404" title="We couldn't find this review task" extra={<Button onClick={() => history.push('/review')}>Back to review</Button>} /></PageContainer>;
  if (taskQuery.isPending) return <PageContainer title="Review task"><Skeleton active /></PageContainer>;
  if (taskQuery.error) return <PageContainer title="Review task"><PageError error={taskQuery.error} onRetry={() => { void taskQuery.refetch(); }} /></PageContainer>;
  if (!task) return null;

  const blocking = task.decisions.approve.blocking_findings ?? [];
  const taskOpen = task.status === 'open';
  return (
    <PageContainer
      title={<ContentText>{task.item.title}</ContentText>}
      onBack={() => history.push('/review')}
      tags={<Space wrap><StatusTag kind="review_reason" status={task.reason} /><StatusTag kind="review" status={task.status} /><Tag>{task.item.format.replace('_', ' ')}</Tag></Space>}
      extra={task.can_recheck ? <JobButton type="primary" start={() => startCheckRun(task.item.id)} activeJob={task.item.active_job} kinds={['qc.run']} onDone={() => { void taskQuery.refetch(); }} onFailed={() => { void taskQuery.refetch(); }}>Run checks again</JobButton> : null}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert type={task.status === 'open' ? 'warning' : 'success'} showIcon title={task.detail} />
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 0.85fr) minmax(360px, 1.15fr)', gap: 16, alignItems: 'start' }}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <TaskMedia task={task} />
            <Card title="Caption and hashtags">
              <ContentText preserveLineBreaks>{task.version.caption || 'No caption.'}</ContentText>
              {task.version.hashtags.length ? <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>{task.version.hashtags.map((tag) => `#${tag}`).join(' ')}</Typography.Paragraph> : null}
              {task.version.alt_text ? <Typography.Text type="secondary">Alt text: {task.version.alt_text}</Typography.Text> : null}
            </Card>
            <DiffCard task={task} />
            {task.publication ? <Card title="Publication"><Descriptions size="small" column={1} items={[{ key: 'status', label: 'Status', children: task.publication.status }, { key: 'attempts', label: 'Attempts', children: task.publication.attempt_count }, { key: 'scheduled', label: 'Scheduled', children: <DateTime value={task.publication.scheduled_at} /> }, { key: 'error', label: 'Last error', children: task.publication.last_error_message ?? task.publication.last_error_code ?? '—' }]} /></Card> : null}
          </Space>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {task.qc_run ? <Card title="Quality check findings"><Space direction="vertical" size={12} style={{ width: '100%' }}>{task.qc_run.results.map((result) => <CheckCard key={result.check} result={result} itemId={task.item.id} runOutcome={task.qc_run?.outcome ?? null} />)}</Space></Card> : null}
            {taskOpen ? (
              <Card title="Decision">
                {blocking.length && decision === 'approve' ? (
                  <Alert type={task.decisions.approve.allowed ? 'warning' : 'error'} showIcon title={task.decisions.approve.allowed ? 'Approval overrides blocking findings.' : 'Approval is blocked by findings that cannot be overridden.'} description={<Space direction="vertical">{blocking.map((finding) => <Typography.Text key={`${finding.check}-${finding.code}`}>{finding.check ? `${finding.check}: ` : ''}{finding.code}{finding.override_allowed === false ? ' · cannot override' : ' · override allowed'}</Typography.Text>)}</Space>} />
                ) : null}
                {decisionState && !decisionState.allowed ? <Alert style={{ marginTop: 12 }} type="error" showIcon title={`This decision is unavailable${decisionState.reason ? ` (${decisionState.reason.replaceAll('_', ' ')})` : ''}.`} /> : null}
              {fieldMessages.length ? <Alert type="error" showIcon title={fieldMessages.join(' ')} /> : null}
              <Form form={form} layout="vertical" initialValues={{ decision: 'approve', approve_time_mode: 'time', rework: 'manual' }} onValuesChange={() => setFieldMessages([])} onFinish={submit} style={{ marginTop: 16 }}>
                  <Form.Item name="decision" label="Choose an outcome" rules={[{ required: true }]}>
                    <Radio.Group optionType="button" buttonStyle="solid">
                      <Radio.Button value="approve" disabled={!task.decisions.approve.allowed}>Approve</Radio.Button>
                      <Radio.Button value="request_changes" disabled={!task.decisions.request_changes.allowed}>Request changes</Radio.Button>
                      <Radio.Button value="reject" disabled={!task.decisions.reject.allowed}>Reject</Radio.Button>
                    </Radio.Group>
                  </Form.Item>
                  {decision === 'approve' && task.reason === 'no_slot' ? (
                    <>
                      <Form.Item name="approve_time_mode" label="Schedule this item using" rules={[{ required: true }]}><Radio.Group options={[{ label: 'Choose a time', value: 'time' }, { label: 'Use an open slot', value: 'slot', disabled: !availableSlots.length }]} /></Form.Item>
                      {timeMode === 'slot' ? (
                        <Form.Item name="slot" label="Open slot" rules={[{ required: true, message: 'Choose an open slot.' }]}>
                          <Select loading={openSlotsQuery.isPending} options={availableSlots.map((slot: PlanSlot) => ({ value: slot.id, label: <><DateTime value={slot.scheduled_at} /> · {slot.format.replace('_', ' ')}</> }))} placeholder="Choose an open slot" />
                        </Form.Item>
                      ) : (
                        <Form.Item name="scheduled_at" label={`Schedule at (${account?.timezone ?? 'UTC'})`} rules={[{ required: true, message: 'Choose a date and time.' }]}>
                          <DatePicker showTime format="D MMM YYYY, HH:mm" style={{ width: '100%' }} disabledDate={(date) => date.isBefore(dayjs().subtract(1, 'day'))} />
                        </Form.Item>
                      )}
                    </>
                  ) : null}
                  {decision === 'request_changes' ? (
                    <>
                      <Form.Item name="rework" label="What should happen next?" rules={[{ required: true }]}>
                        <Select options={(task.decisions.request_changes.rework_options ?? ['manual']).map((value) => ({ value, label: value === 'copy' ? 'Rewrite the caption' : value === 'script' ? 'Rewrite the script and render again' : 'I will fix it myself in Production' }))} />
                      </Form.Item>
                      <Form.Item name="instructions" label="Instructions" rules={[{ required: true, min: 10, max: 2000 }]}><Input.TextArea rows={4} showCount maxLength={2000} placeholder="Explain what needs to change." /></Form.Item>
                    </>
                  ) : null}
                  {(decision === 'reject' || (decision === 'approve' && task.decisions.approve.requires_note)) && task.reason !== 'no_slot' ? (
                    <Form.Item name="decision_note" label={decision === 'reject' ? 'Reason for rejection' : 'Approval note'} rules={[{ required: true, min: decision === 'reject' ? 3 : 10, max: decision === 'reject' ? 500 : 1000 }]}><Input.TextArea rows={3} showCount maxLength={decision === 'reject' ? 500 : 1000} placeholder={decision === 'reject' ? 'Explain why this item is rejected.' : 'Record how the blocking finding was verified.'} /></Form.Item>
                  ) : null}
                  {decision === 'reject' ? <Form.Item name="release_candidate" valuePropName="checked"><Checkbox>Return this source to the candidate pool</Checkbox></Form.Item> : null}
                  <Button type="primary" htmlType="submit" loading={mutation.isPending} disabled={!decisionState?.allowed} danger={decision === 'reject'}>
                    {decision === 'approve' ? 'Approve item' : decision === 'request_changes' ? 'Request changes' : 'Reject item'}
                  </Button>
                </Form>
              </Card>
            ) : <Card title="Decision"><Typography.Text>Resolved {task.decision ? `as ${task.decision.replace('_', ' ')}` : ''} {task.resolved_at ? <><DateTime value={task.resolved_at} /> · {task.resolved_by?.name ?? 'Team member'}</> : null}</Typography.Text>{task.decision_note ? <Typography.Paragraph>{task.decision_note}</Typography.Paragraph> : null}</Card>}
          </Space>
        </div>
      </Space>
    </PageContainer>
  );
};

const ReviewTaskPage: React.FC = () => {
  const { taskId = '' } = useParams<{ taskId: string }>();
  const { accountId } = useCurrentAccount();
  return <AccountGate title="Review task">{accountId !== null ? <TaskReview key={`${accountId}:${taskId}`} taskId={taskId} /> : null}</AccountGate>;
};

export default ReviewTaskPage;
