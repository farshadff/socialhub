import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '@ant-design/pro-components';
import { Link } from '@umijs/max';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Empty,
  Form,
  Input,
  Modal,
  Radio,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import React, { useMemo, useState } from 'react';
import AccountGate from '@/components/AccountGate';
import DateTime from '@/components/DateTime';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import { type CalendarEntry, cancelPublication, getCalendar, markPublicationPublished, publishNow, reschedulePublication, retryPublication } from '@/services/socialhub/publishing';
import { accountQueryKey, useCurrentAccount } from '@/utils/accountRequest';
import { notifyError } from '@/utils/errorText';
import { Thumbnail } from '../content/parts';

dayjs.extend(utc);
dayjs.extend(timezone);

type RescheduleMode = 'time' | 'slot';
type RescheduleValues = { mode: RescheduleMode; scheduled_at?: Dayjs; slot?: number };
type MarkPublishedValues = { permalink: string; published_at?: Dayjs; verify?: boolean };

const dateText = (date: Dayjs) => date.format('YYYY-MM-DD');
const startOfWeek = (zone: string, firstDay: number) => {
  const today = dayjs().tz(zone);
  const accountWeekday = (today.day() + 6) % 7;
  return today.subtract((accountWeekday - firstDay + 7) % 7, 'day').startOf('day');
};

const CalendarEntryCard: React.FC<{
  entry: CalendarEntry;
  controls: React.ReactNode;
}> = ({ entry, controls }) => {
  const publication = entry.publication;
  const item = entry.content_item;
  const isDueByHand = publication?.delivery === 'manual' && publication.scheduled_at && dayjs(publication.scheduled_at).isBefore(dayjs());
  return (
    <Card size="small" style={{ marginBottom: 8 }}>
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
          <Space wrap>
            <DateTime value={entry.at} format="time" />
            <Tag>{entry.format.replace('_', ' ')}</Tag>
            {publication ? <StatusTag kind="publication" status={isDueByHand ? 'post_by_hand_due' : publication.status} /> : <StatusTag kind="slot" status={entry.slot?.status ?? 'open'} />}
            {publication?.delivery === 'manual' ? <Tag>Post by hand</Tag> : null}
            {publication?.blocked_reason ? <Tooltip title={publication.blocked_reason}><Typography.Text type="danger">Blocked</Typography.Text></Tooltip> : null}
          </Space>
          {entry.slot?.role ? <Typography.Text type="secondary">{entry.slot.role.replace('_', ' ')}</Typography.Text> : null}
        </Space>
        {item ? <Space align="start"><Thumbnail item={{ thumbnail_url: publication?.thumbnail_url ?? null, format: entry.format, title: item.title }} /><div><Link to={`/content/${item.id}?tab=publishing`}><Typography.Text strong>{item.title}</Typography.Text></Link><br /><Typography.Text type="secondary">{item.status.replace('_', ' ')}</Typography.Text></div></Space> : <Typography.Text type="secondary">Empty slot</Typography.Text>}
        {publication ? <Space wrap>{controls}{item ? <Link to={`/content/${item.id}?tab=publishing`}>Publishing details</Link> : null}{publication.permalink ? <a href={publication.permalink} target="_blank" rel="noreferrer">View live post</a> : null}</Space> : item ? <Link to={`/content/${item.id}?tab=publishing`}>Open item</Link> : null}
      </Space>
    </Card>
  );
};

const CalendarPageContent: React.FC<{ accountId: number; timezoneName: string; weekStartDay: number }> = ({ accountId, timezoneName, weekStartDay }) => {
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(timezoneName, weekStartDay));
  const [view, setView] = useState<'week' | 'list'>('week');
  const [rescheduling, setRescheduling] = useState<CalendarEntry | null>(null);
  const [cancelling, setCancelling] = useState<CalendarEntry | null>(null);
  const [marking, setMarking] = useState<CalendarEntry | null>(null);
  const [rescheduleForm] = Form.useForm<RescheduleValues>();
  const [cancelForm] = Form.useForm<{ reason: string }>();
  const [markForm] = Form.useForm<MarkPublishedValues>();
  const rescheduleMode = Form.useWatch('mode', rescheduleForm);
  const from = dateText(weekStart);
  const to = dateText(weekStart.add(6, 'day'));
  const queryKey = accountQueryKey(accountId, 'calendar', { from, to });
  const query = useQuery({
    queryKey,
    queryFn: () => getCalendar({ from, to }),
    refetchInterval: (current) => current.state.data?.entries.some((entry) => ['publishing', 'verifying'].includes(entry.publication?.status ?? '')) ? 5000 : false,
  });
  const calendar = query.data;
  const entries = calendar?.entries ?? [];
  const days = useMemo(() => Array.from({ length: 7 }, (_, offset) => weekStart.add(offset, 'day')), [from]);
  const openSlots = entries.filter((entry): entry is CalendarEntry & { slot: NonNullable<CalendarEntry['slot']> } => entry.kind === 'slot' && entry.slot?.status === 'open');

  const refresh = () => queryClient.invalidateQueries({ queryKey: accountQueryKey(accountId, 'calendar') });
  const reschedule = useMutation({
    mutationFn: (input: { entry: CalendarEntry; body: { scheduled_at: string } | { slot: number } }) => {
      const publication = input.entry.publication;
      if (!publication) throw new Error('This calendar entry has no publication.');
      return reschedulePublication(publication.id, input.body);
    },
    onSuccess: () => { message.success('Publication rescheduled'); setRescheduling(null); refresh(); },
    onError: (error) => notifyError(error),
  });
  const cancel = useMutation({
    mutationFn: (input: { entry: CalendarEntry; reason: string }) => {
      const publication = input.entry.publication;
      if (!publication) throw new Error('This calendar entry has no publication.');
      return cancelPublication(publication.id, input.reason);
    },
    onSuccess: () => { message.success('Publication cancelled'); setCancelling(null); refresh(); },
    onError: (error) => notifyError(error),
  });
  const sendNow = useMutation({
    mutationFn: (id: number) => publishNow(id),
    onSuccess: () => { message.success('Publication sent to the publishing queue'); refresh(); },
    onError: (error) => notifyError(error),
  });
  const retry = useMutation({
    mutationFn: (id: number) => retryPublication(id),
    onSuccess: () => { message.success('Publication retry queued'); refresh(); },
    onError: (error) => notifyError(error),
  });
  const mark = useMutation({
    mutationFn: (input: { id: number; body: { permalink: string; published_at?: string; verify: boolean } }) => markPublicationPublished(input.id, input.body),
    onSuccess: (result) => {
      message.success(result.found ? 'Post verified on Instagram' : 'Publication marked as published');
      if (!result.found) message.warning('Instagram could not match the link. Enter metrics by hand for this post.');
      setMarking(null);
      refresh();
    },
    onError: (error) => notifyError(error),
  });

  const saveReschedule = (values: RescheduleValues) => {
    if (!rescheduling?.publication) return;
    if (values.mode === 'slot' && values.slot) {
      reschedule.mutate({ entry: rescheduling, body: { slot: values.slot } });
      return;
    }
    const value = values.scheduled_at?.format('YYYY-MM-DD HH:mm');
    if (!value) return;
    reschedule.mutate({ entry: rescheduling, body: { scheduled_at: dayjs.tz(value, timezoneName).utc().toISOString() } });
  };

  const cancelPublicationNow = async ({ reason }: { reason: string }) => {
    if (cancelling?.publication) cancel.mutate({ entry: cancelling, reason: reason.trim() });
  };
  const saveMarkedPublication = (values: MarkPublishedValues) => {
    if (!marking?.publication) return;
    const localTime = values.published_at?.format('YYYY-MM-DD HH:mm');
    mark.mutate({
      id: marking.publication.id,
      body: {
        permalink: values.permalink.trim(),
        published_at: localTime ? dayjs.tz(localTime, timezoneName).utc().toISOString() : undefined,
        verify: values.verify ?? true,
      },
    });
  };

  const publicationControls = (entry: CalendarEntry) => {
    const publication = entry.publication;
    if (!publication) return null;
    return (
      <Space wrap>
        {publication.allowed_actions.includes('reschedule') ? <Button size="small" onClick={() => { rescheduleForm.resetFields(); rescheduleForm.setFieldsValue({ mode: 'time' }); setRescheduling(entry); }}>Reschedule</Button> : null}
        {publication.allowed_actions.includes('cancel') ? <Button size="small" danger onClick={() => { cancelForm.resetFields(); setCancelling(entry); }}>Cancel</Button> : null}
        {publication.allowed_actions.includes('publish_now') ? <Button size="small" type="primary" loading={sendNow.isPending} onClick={() => Modal.confirm({ title: `Publish “${entry.content_item?.title ?? 'this item'}” now?`, content: 'Account and Instagram limits still apply.', okText: 'Publish now', onOk: () => sendNow.mutate(publication.id) })}>Publish now</Button> : null}
        {publication.allowed_actions.includes('retry') ? <Button size="small" type="primary" loading={retry.isPending} onClick={() => Modal.confirm({ title: `Verify and retry “${entry.content_item?.title ?? 'this publication'}”?`, content: 'The system checks the previous attempt before sending again.', okText: 'Verify and retry', onOk: () => retry.mutate(publication.id) })}>Verify and retry</Button> : null}
        {publication.allowed_actions.includes('mark_published') ? <Button size="small" onClick={() => { markForm.resetFields(); markForm.setFieldsValue({ verify: true }); setMarking(entry); }}>Mark as published</Button> : null}
      </Space>
    );
  };

  const columns: ColumnsType<CalendarEntry> = [
    { title: 'Time', dataIndex: 'at', width: 150, render: (_, entry) => <DateTime value={entry.at} /> },
    { title: 'Item', dataIndex: ['content_item', 'title'], render: (_, entry) => entry.content_item ? <Link to={`/content/${entry.content_item.id}?tab=publishing`}>{entry.content_item.title}</Link> : 'Empty slot' },
    { title: 'Format', dataIndex: 'format', render: (_, entry) => entry.format.replace('_', ' ') },
    { title: 'Status', key: 'status', render: (_, entry) => entry.publication ? <StatusTag kind="publication" status={entry.publication.status} /> : <StatusTag kind="slot" status={entry.slot?.status ?? 'open'} /> },
    { title: 'Delivery', key: 'delivery', render: (_, entry) => entry.publication?.delivery === 'manual' ? 'By hand' : entry.publication ? 'Instagram' : '—' },
    { title: 'Action', key: 'action', render: (_, entry) => <Space wrap>{publicationControls(entry)}{entry.publication && entry.content_item ? <Link to={`/content/${entry.content_item.id}?tab=publishing`}>Open</Link> : entry.content_item ? <Link to={`/content/${entry.content_item.id}`}>Open item</Link> : null}</Space> },
  ];

  return (
    <PageContainer
      title="Calendar"
      content="Scheduled posts, publications, and open slots for this account."
      extra={<Space wrap><Button onClick={() => setWeekStart((current) => current.subtract(7, 'day'))}>Previous week</Button><Button onClick={() => setWeekStart(startOfWeek(timezoneName, weekStartDay))}>This week</Button><Button onClick={() => setWeekStart((current) => current.add(7, 'day'))}>Next week</Button></Space>}
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {calendar ? <Alert type={calendar.publishing_enabled ? 'success' : 'error'} showIcon title={calendar.publishing_enabled ? 'Publishing is on' : 'Publishing is switched off'} description={`Account time zone: ${calendar.timezone}. Feed and reels: ${calendar.posting_rules.max_feed_per_day} per day · Stories: ${calendar.posting_rules.max_stories_per_day} per day · Minimum gap: ${calendar.posting_rules.min_gap_minutes} minutes.`} /> : null}
        <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
          <Typography.Title level={4} style={{ margin: 0 }}>{weekStart.format('D MMM')} – {weekStart.add(6, 'day').format('D MMM YYYY')}</Typography.Title>
          <Segmented value={view} options={[{ label: 'Week', value: 'week' }, { label: 'List', value: 'list' }]} onChange={(next) => setView(next as 'week' | 'list')} />
        </Space>
        {query.isError ? <PageError error={query.error} onRetry={() => { void query.refetch(); }} /> : null}
        {query.isPending ? <Card loading /> : null}
        {!query.isPending && !query.isError && view === 'week' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12 }}>
            {days.map((date) => {
              const localDate = dateText(date);
              const entriesForDay = entries.filter((entry) => entry.date === localDate);
              const dayCounts = calendar?.days.find((day) => day.date === localDate);
              return (
                <Card key={localDate} size="small" title={<Space direction="vertical" size={0}><Typography.Text strong>{date.format('ddd, D MMM')}</Typography.Text><Typography.Text type="secondary">Feed / reels {dayCounts?.feed_count ?? 0} of {calendar?.posting_rules.max_feed_per_day ?? 0} · Stories {dayCounts?.story_count ?? 0} of {calendar?.posting_rules.max_stories_per_day ?? 0}</Typography.Text></Space>}>
                  {entriesForDay.length ? entriesForDay.map((entry, index) => <CalendarEntryCard key={`${entry.kind}-${entry.slot?.id ?? entry.publication?.id ?? index}`} entry={entry} controls={publicationControls(entry)} />) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No slots or publications" />}
                </Card>
              );
            })}
          </div>
        ) : null}
        {!query.isPending && !query.isError && view === 'list' ? (
          <Table rowKey={(entry) => `${entry.kind}-${entry.slot?.id ?? entry.publication?.id ?? entry.at}`} columns={columns} dataSource={entries} pagination={false} locale={{ emptyText: <Empty description="No slots or publications this week." /> }} scroll={{ x: 800 }} />
        ) : null}
      </Space>

      <Modal title="Reschedule publication" open={Boolean(rescheduling)} onCancel={() => setRescheduling(null)} onOk={() => rescheduleForm.submit()} confirmLoading={reschedule.isPending} okText="Save time">
        <Form form={rescheduleForm} layout="vertical" initialValues={{ mode: 'time' }} onFinish={saveReschedule}>
          <Form.Item name="mode" label="Move to" rules={[{ required: true }]}><Radio.Group options={[{ label: 'Choose a date and time', value: 'time' }, { label: 'Use an open slot this week', value: 'slot', disabled: !openSlots.some((entry) => entry.format === rescheduling?.format) }]} /></Form.Item>
          {rescheduleMode === 'slot' ? (
            <Form.Item name="slot" label="Open slot" rules={[{ required: true }]}><Select options={openSlots.filter((entry) => entry.format === rescheduling?.format).map((entry) => ({ value: entry.slot.id, label: <DateTime value={entry.at} /> }))} placeholder="Choose a slot" /></Form.Item>
          ) : (
            <Form.Item name="scheduled_at" label={`New time (${timezoneName})`} rules={[{ required: true }]}><DatePicker showTime format="D MMM YYYY, HH:mm" style={{ width: '100%' }} /></Form.Item>
          )}
        </Form>
      </Modal>
      <Modal title="Cancel publication" open={Boolean(cancelling)} onCancel={() => setCancelling(null)} onOk={() => cancelForm.submit()} confirmLoading={cancel.isPending} okText="Cancel publication" okButtonProps={{ danger: true }}>
        <Form form={cancelForm} layout="vertical" onFinish={cancelPublicationNow}>
          <Alert type="warning" showIcon title="Cancelling also cancels the content item and releases its slot." />
          <Form.Item name="reason" label="Reason" rules={[{ required: true, min: 3, max: 500 }]} style={{ marginTop: 16 }}><Input.TextArea rows={3} maxLength={500} showCount /></Form.Item>
        </Form>
      </Modal>
      <Modal title="Mark as published" open={Boolean(marking)} onCancel={() => setMarking(null)} onOk={() => markForm.submit()} confirmLoading={mark.isPending} okText="Save post link">
        <Form form={markForm} layout="vertical" onFinish={saveMarkedPublication}>
          <Form.Item name="permalink" label="Instagram post link" rules={[{ required: true, type: 'url' }]}><Input placeholder="https://www.instagram.com/p/..." /></Form.Item>
          <Form.Item name="published_at" label={`Published at (${timezoneName})`}><DatePicker showTime format="D MMM YYYY, HH:mm" style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="verify" valuePropName="checked"><Checkbox>Try to verify this link with Instagram</Checkbox></Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
};

const CalendarPage: React.FC = () => {
  const { account, accountId } = useCurrentAccount();
  return <AccountGate title="Calendar">{account && accountId !== null ? <CalendarPageContent key={accountId} accountId={accountId} timezoneName={account.timezone} weekStartDay={account.week_start_day} /> : null}</AccountGate>;
};

export default CalendarPage;
