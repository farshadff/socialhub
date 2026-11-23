import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  Space,
  Table,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import React, { useState } from 'react';
import ContentText from '@/components/ContentText';
import DateTime from '@/components/DateTime';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import MediaPreview from '@/pages/content/shared/MediaPreview';
import type { ContentItemDetail } from '@/services/socialhub/content';
import { getPublication, cancelPublication, markPublicationPublished, publishNow, reschedulePublication, retryPublication, type Publication, type PublishAttempt } from '@/services/socialhub/publishing';
import { accountQueryKey, useCurrentAccount } from '@/utils/accountRequest';
import { notifyError } from '@/utils/errorText';

dayjs.extend(utc);
dayjs.extend(timezone);

type ScheduleForm = { scheduled_at?: Dayjs };
type CancelForm = { reason: string };
type MarkForm = { permalink: string; published_at?: Dayjs; verify?: boolean };
type VerificationCheck = NonNullable<NonNullable<PublishAttempt['verification']>['checks']>[number];

const AttemptVerification: React.FC<{ attempt: PublishAttempt }> = ({ attempt }) => {
  const checks = attempt.verification?.checks ?? [];
  return (
    <Card size="small" title={`Attempt ${attempt.number} · ${attempt.outcome}`}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Typography.Text type="secondary"><DateTime value={attempt.started_at} />{attempt.finished_at ? <> – <DateTime value={attempt.finished_at} /></> : null} · {attempt.provider}</Typography.Text>
        {attempt.error_message ? <Typography.Text type="danger">{attempt.error_code ? `${attempt.error_code}: ` : ''}{attempt.error_message}</Typography.Text> : null}
        {checks.length ? <Table<VerificationCheck> size="small" pagination={false} rowKey={(check) => `${check.at}-${check.method}`} dataSource={checks} columns={[
          { title: 'Checked', dataIndex: 'at', render: (_, row) => <DateTime value={row.at} /> },
          { title: 'Method', dataIndex: 'method' },
          { title: 'Container', dataIndex: 'container_status', render: (value) => value ?? '—' },
          { title: 'Result', dataIndex: 'result' },
        ]} /> : <Typography.Text type="secondary">No verification checks recorded.</Typography.Text>}
        {attempt.verification?.final_check_pending ? <Alert type="warning" showIcon title="A final verification is still pending." /> : null}
      </Space>
    </Card>
  );
};

const PublishingTab: React.FC<{
  item: ContentItemDetail;
  reload: () => unknown;
}> = ({ item, reload }) => {
  const { account } = useCurrentAccount();
  const accountId = item.account;
  const queryClient = useQueryClient();
  const publicationId = item.publication?.id;
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [markOpen, setMarkOpen] = useState(false);
  const [scheduleForm] = Form.useForm<ScheduleForm>();
  const [cancelForm] = Form.useForm<CancelForm>();
  const [markForm] = Form.useForm<MarkForm>();
  const publicationQuery = useQuery({
    queryKey: accountQueryKey(accountId, 'publication', publicationId),
    enabled: Boolean(publicationId),
    queryFn: () => getPublication(publicationId as number),
    refetchInterval: (query) => ['publishing', 'verifying'].includes(query.state.data?.status ?? '') ? 5000 : false,
  });
  const publication = publicationQuery.data;
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: accountQueryKey(accountId, 'publication', publicationId) }),
      queryClient.invalidateQueries({ queryKey: accountQueryKey(accountId, 'calendar') }),
      queryClient.invalidateQueries({ queryKey: ['content-item', String(item.id)] }),
    ]);
    reload();
  };
  const handleError = (error: unknown) => { notifyError(error); void publicationQuery.refetch(); };
  const reschedule = useMutation({
    mutationFn: (input: { id: number; scheduled_at: string }) => reschedulePublication(input.id, { scheduled_at: input.scheduled_at }),
    onSuccess: () => { message.success('Publication rescheduled'); setRescheduleOpen(false); void invalidate(); },
    onError: handleError,
  });
  const cancel = useMutation({
    mutationFn: (input: { id: number; reason: string }) => cancelPublication(input.id, input.reason),
    onSuccess: () => { message.success('Publication cancelled'); setCancelOpen(false); void invalidate(); },
    onError: handleError,
  });
  const sendNow = useMutation({
    mutationFn: (id: number) => publishNow(id),
    onSuccess: () => { message.success('Publication sent to the publishing queue'); void invalidate(); },
    onError: handleError,
  });
  const retry = useMutation({
    mutationFn: (id: number) => retryPublication(id),
    onSuccess: () => { message.success('Publication retry queued'); void invalidate(); },
    onError: handleError,
  });
  const mark = useMutation({
    mutationFn: (input: { id: number; body: { permalink: string; published_at?: string; verify: boolean } }) => markPublicationPublished(input.id, input.body),
    onSuccess: async (result) => {
      message.success(result.found ? 'Post verified on Instagram' : 'Publication marked as published');
      if (!result.found) message.warning('Instagram could not match the link. Enter metrics by hand for this post.');
      setMarkOpen(false);
      await invalidate();
    },
    onError: handleError,
  });

  const saveReschedule = (values: ScheduleForm) => {
    if (!publication || !values.scheduled_at) return;
    const localValue = values.scheduled_at.format('YYYY-MM-DD HH:mm');
    reschedule.mutate({ id: publication.id, scheduled_at: dayjs.tz(localValue, account?.timezone ?? 'UTC').utc().toISOString() });
    setRescheduleOpen(false);
  };
  const saveCancel = (values: CancelForm) => {
    if (publication) cancel.mutate({ id: publication.id, reason: values.reason.trim() });
  };
  const saveMark = (values: MarkForm) => {
    if (!publication) return;
    const localValue = values.published_at?.format('YYYY-MM-DD HH:mm');
    mark.mutate({ id: publication.id, body: { permalink: values.permalink.trim(), published_at: localValue ? dayjs.tz(localValue, account?.timezone ?? 'UTC').utc().toISOString() : undefined, verify: values.verify ?? true } });
  };

  if (!publicationId) {
    return (
      <Card title="Publishing">
        <Empty description={item.status === 'approved' ? 'This item is approved and will be scheduled automatically.' : 'A publication will appear here after this item passes its checks and is scheduled.'}>
          {item.open_review_task ? <Button onClick={() => { window.location.href = `/review/${item.open_review_task?.id}`; }}>Open review task</Button> : null}
        </Empty>
      </Card>
    );
  }
  if (publicationQuery.isPending) return <Card><Typography.Title level={4}>Publishing</Typography.Title><Typography.Text type="secondary">Loading publication…</Typography.Text></Card>;
  if (publicationQuery.error) return <PageError error={publicationQuery.error} onRetry={() => { void publicationQuery.refetch(); }} />;
  if (!publication) return null;

  const allowed = (name: Publication['allowed_actions'][number]) => publication.allowed_actions.includes(name);
  const asset = publication.content_version.cover_asset ?? publication.content_version.final_asset;
  const isDueByHand = publication.delivery === 'manual' && publication.status === 'scheduled' && Boolean(publication.scheduled_at && dayjs(publication.scheduled_at).isBefore(dayjs()));
  const columns: ColumnsType<PublishAttempt> = [
    { title: 'Attempt', dataIndex: 'number' },
    { title: 'Provider', dataIndex: 'provider' },
    { title: 'Started', dataIndex: 'started_at', render: (_, row) => <DateTime value={row.started_at} /> },
    { title: 'Finished', dataIndex: 'finished_at', render: (_, row) => <DateTime value={row.finished_at} /> },
    { title: 'Outcome', dataIndex: 'outcome', render: (_, row) => <StatusTag kind="attempt" status={row.outcome} /> },
    { title: 'Error', dataIndex: 'error_message', render: (_, row) => row.error_message ?? row.error_code ?? '—' },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {publication.blocked_reason ? <Alert type="warning" showIcon title={publication.blocked_reason} /> : null}
      {publication.delivery === 'manual' ? <Alert type={isDueByHand ? 'warning' : 'info'} showIcon title={isDueByHand ? 'This post is due to be published by hand.' : 'This format uses manual publishing.'} description="Download the final asset, copy the caption, publish it on Instagram, then record the link here." /> : null}
      <Card title="Publication" extra={<StatusTag kind="publication" status={isDueByHand ? 'post_by_hand_due' : publication.status} />}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} items={[
            { key: 'scheduled', label: 'Scheduled', children: <DateTime value={publication.scheduled_at} /> },
            { key: 'delivery', label: 'Delivery', children: publication.delivery === 'manual' ? 'By hand' : 'Instagram' },
            { key: 'attempts', label: 'Attempts', children: `${publication.attempt_count} of ${publication.max_attempts}` },
            { key: 'next', label: 'Next attempt', children: <DateTime value={publication.next_attempt_at} /> },
            { key: 'container', label: 'Container status', children: publication.container_status ?? '—' },
            { key: 'published', label: 'Published', children: <DateTime value={publication.published_at} /> },
          ]} />
          {publication.permalink ? <a href={publication.permalink} target="_blank" rel="noreferrer">View on Instagram</a> : null}
          <Space wrap>
            {allowed('reschedule') ? <Button onClick={() => { scheduleForm.resetFields(); setRescheduleOpen(true); }}>Reschedule</Button> : null}
            {allowed('cancel') ? <Button danger onClick={() => { cancelForm.resetFields(); setCancelOpen(true); }}>Cancel publication</Button> : null}
            {allowed('publish_now') ? <Button type="primary" loading={sendNow.isPending} onClick={() => Modal.confirm({ title: `Publish “${item.title}” now?`, content: 'Normal account and Instagram limits still apply.', okText: 'Publish now', onOk: () => sendNow.mutate(publication.id) })}>Publish now</Button> : null}
            {allowed('retry') ? <Button type="primary" loading={retry.isPending} onClick={() => Modal.confirm({ title: `Verify and retry “${item.title}”?`, content: 'The system will verify the previous attempt before sending again.', okText: 'Verify and retry', onOk: () => retry.mutate(publication.id) })}>Verify and retry</Button> : null}
            {allowed('mark_published') ? <Button type="primary" onClick={() => { markForm.resetFields(); markForm.setFieldsValue({ verify: true }); setMarkOpen(true); }}>Mark as published</Button> : null}
          </Space>
        </Space>
      </Card>

      {publication.delivery === 'manual' || allowed('mark_published') ? (
        <Card title="Post by hand">
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {asset ? <Space wrap>
              <MediaPreview asset={publication.content_version.final_asset} cover={publication.content_version.cover_asset} format={publication.format} alt={`Final asset for ${item.title}`} maxHeight={320} />
              <Space direction="vertical"><a href={asset.url} download target="_blank" rel="noreferrer"><Button>Download final asset</Button></a>{publication.content_version.cover_asset ? <a href={publication.content_version.cover_asset.url} download target="_blank" rel="noreferrer">Download cover image</a> : null}</Space>
            </Space> : <Alert type="error" showIcon title="No final asset is attached to this publication." />}
            <Card size="small" title="Caption">
              <ContentText as="p" preserveLineBreaks>{publication.full_caption}</ContentText>
              <Button size="small" onClick={async () => { try { await navigator.clipboard.writeText(publication.full_caption); message.success('Caption copied'); } catch { message.error('Could not copy the caption. Select and copy it manually.'); } }}>Copy caption</Button>
            </Card>
          </Space>
        </Card>
      ) : null}

      <Card title="Publish attempts">
        {publication.attempts?.length ? <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Table<PublishAttempt> rowKey="id" size="small" pagination={false} dataSource={publication.attempts} columns={columns} scroll={{ x: 700 }} />
          {publication.attempts.map((attempt) => <AttemptVerification key={attempt.id} attempt={attempt} />)}
        </Space> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No publish attempts yet." />}
      </Card>

      <Modal title="Reschedule publication" open={rescheduleOpen} onCancel={() => setRescheduleOpen(false)} onOk={() => scheduleForm.submit()} confirmLoading={reschedule.isPending}>
        <Form form={scheduleForm} layout="vertical" onFinish={saveReschedule}>
          <Form.Item name="scheduled_at" label={`New time (${account?.timezone ?? 'UTC'})`} rules={[{ required: true }]}><DatePicker showTime format="D MMM YYYY, HH:mm" style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>
      <Modal title="Cancel publication" open={cancelOpen} onCancel={() => setCancelOpen(false)} onOk={() => cancelForm.submit()} confirmLoading={cancel.isPending} okText="Cancel publication" okButtonProps={{ danger: true }}>
        <Form form={cancelForm} layout="vertical" onFinish={saveCancel}><Alert type="warning" showIcon title="This also cancels the content item and releases its slot." /><Form.Item name="reason" label="Reason" rules={[{ required: true, min: 3, max: 500 }]} style={{ marginTop: 16 }}><Input.TextArea rows={3} maxLength={500} showCount /></Form.Item></Form>
      </Modal>
      <Modal title="Mark as published" open={markOpen} onCancel={() => setMarkOpen(false)} onOk={() => markForm.submit()} confirmLoading={mark.isPending} okText="Save post link">
        <Form form={markForm} layout="vertical" onFinish={saveMark}>
          <Form.Item name="permalink" label="Instagram post link" rules={[{ required: true, type: 'url' }]}><Input placeholder="https://www.instagram.com/p/..." /></Form.Item>
          <Form.Item name="published_at" label={`Published at (${account?.timezone ?? 'UTC'})`}><DatePicker showTime format="D MMM YYYY, HH:mm" style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="verify" valuePropName="checked"><Checkbox>Try to verify this link with Instagram</Checkbox></Form.Item>
        </Form>
      </Modal>
    </Space>
  );
};

export default PublishingTab;
