import { CopyOutlined } from '@ant-design/icons';
import { ProForm } from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  List,
  Modal,
  message,
  Progress,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import React, { useState } from 'react';
import ContentText from '@/components/ContentText';
import DateTime from '@/components/DateTime';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import type { Account } from '@/services/socialhub/accounts';
import { isApiError } from '@/services/socialhub/http';
import type { PlanSummary } from '@/services/socialhub/plans';
import {
  getTopic,
  type TrendSignal,
  type TrendTopicDetail,
  updateTopic,
} from '@/services/socialhub/research';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { notifyError } from '@/utils/errorText';
import AttachSignalsModal from './AttachSignalsModal';
import {
  EVIDENCE_LABEL,
  formatMetrics,
  planLabel,
  topicActions,
} from './constants';
import { ExternalLink, FormatTags, KindTag } from './shared';
import TopicFormFields, {
  cleanTopicValues,
  type TopicFormValues,
} from './TopicFormFields';
import { changeTopicStatus } from './topicStatus';

export type TopicDrawerProps = {
  topicId: number | null;
  account: Account;
  readOnly: boolean;
  plans: PlanSummary[];
  onClose: () => void;
  onChanged: () => void;
};

export const SignalItem: React.FC<{ signal: TrendSignal }> = ({ signal }) => {
  const metrics = formatMetrics(signal.metrics);
  return (
    <List.Item>
      <Space orientation="vertical" size={2} style={{ width: '100%' }}>
        <Space size={8} wrap>
          <KindTag kind={signal.kind} />
          {signal.url ? (
            <ExternalLink href={signal.url}>
              <ContentText>{signal.title}</ContentText>
            </ExternalLink>
          ) : (
            <ContentText strong>{signal.title}</ContentText>
          )}
        </Space>
        <Typography.Text type="secondary">
          <ContentText>{signal.author || '—'}</ContentText>
          {' · '}
          <DateTime value={signal.published_at} format="date" empty="No date" />
          {metrics ? ` · ${metrics}` : null}
        </Typography.Text>
        {signal.excerpt ? (
          <Typography.Paragraph
            dir="auto"
            style={{ marginBottom: 0 }}
            ellipsis={{ rows: 2, expandable: true, symbol: 'More' }}
          >
            {signal.excerpt}
          </Typography.Paragraph>
        ) : null}
      </Space>
    </List.Item>
  );
};

export const EvidenceBars: React.FC<{ topic: TrendTopicDetail }> = ({
  topic,
}) => {
  if (topic.evidence_score === 0 && topic.signals.length === 0) {
    return (
      <Typography.Text type="secondary">
        No evidence attached yet. Add signals to give this topic a score.
      </Typography.Text>
    );
  }
  return (
    <Space orientation="vertical" style={{ width: '100%' }} size={4}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        {topic.evidence_score}
      </Typography.Title>
      <Typography.Text type="secondary">
        Calculated from the signals below.
      </Typography.Text>
      {(Object.keys(EVIDENCE_LABEL) as (keyof typeof EVIDENCE_LABEL)[]).map(
        (key) => (
          <div key={key}>
            <Typography.Text>{EVIDENCE_LABEL[key]}</Typography.Text>
            <Progress
              percent={topic.evidence_breakdown?.[key] ?? 0}
              size="small"
              format={(value) => `${value}`}
              aria-label={EVIDENCE_LABEL[key]}
            />
          </div>
        ),
      )}
    </Space>
  );
};

/** Topic detail: read, triage, edit and attach evidence (E02-S05 Panel). */
const TopicDrawer: React.FC<TopicDrawerProps> = ({
  topicId,
  account,
  readOnly,
  plans,
  onClose,
  onChanged,
}) => {
  const [editing, setEditing] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<TopicFormValues>();

  const query = useQuery({
    queryKey: [account.id, 'research-topic', topicId],
    queryFn: () => getTopic(topicId as number),
    enabled: topicId !== null,
  });
  const topic = query.data;
  const refresh = () => {
    query.refetch();
    onChanged();
  };

  const close = () => {
    const finish = () => {
      setEditing(false);
      onClose();
    };
    if (editing && form.isFieldsTouched()) {
      Modal.confirm({
        title: 'Discard your changes?',
        okText: 'Discard',
        cancelText: 'Keep editing',
        onOk: finish,
      });
    } else {
      finish();
    }
  };

  const save = async (values: TopicFormValues) => {
    if (!topic) return;
    setSaving(true);
    try {
      await updateTopic(topic.id, cleanTopicValues(values));
      message.success('Topic saved');
      setEditing(false);
      refresh();
    } catch (error) {
      if (isApiError(error) && error.code === 'invalid_transition') {
        message.warning('This topic changed. Reloading.');
        setEditing(false);
        refresh();
      } else {
        const unmatched = applyFieldErrors(form, error);
        if (
          unmatched.length ||
          !form.getFieldsError().some((f) => f.errors.length)
        ) {
          notifyError(error);
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const canEdit = !readOnly && topic && topic.status !== 'used';
  const plan = topic?.plan ? plans.find((p) => p.id === topic.plan) : null;

  let body: React.ReactNode;
  if (query.isLoading) {
    body = <Skeleton active paragraph={{ rows: 8 }} />;
  } else if (query.error || !topic) {
    body = <PageError error={query.error} onRetry={() => query.refetch()} />;
  } else if (editing) {
    body = (
      <ProForm<TopicFormValues>
        key={topic.id}
        form={form}
        initialValues={{
          title: topic.title,
          summary: topic.summary,
          why_now: topic.why_now,
          hooks: topic.hooks,
          suggested_formats: topic.suggested_formats,
          keywords: topic.keywords,
        }}
        onFinish={save}
        submitter={{
          render: () => (
            <Space>
              <Button type="primary" htmlType="submit" loading={saving}>
                {topic.status === 'new' ? 'Save and shortlist' : 'Save'}
              </Button>
              <Button onClick={() => setEditing(false)}>Cancel</Button>
            </Space>
          ),
        }}
      >
        <TopicFormFields />
      </ProForm>
    );
  } else {
    body = (
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        {topic.summary ? (
          <ContentText as="p" preserveLineBreaks>
            {topic.summary}
          </ContentText>
        ) : null}
        {topic.why_now ? (
          <div>
            <Typography.Title level={5}>Why now</Typography.Title>
            <ContentText as="p" preserveLineBreaks>
              {topic.why_now}
            </ContentText>
          </div>
        ) : null}
        <div>
          <Typography.Title level={5}>Hooks</Typography.Title>
          {topic.hooks.length ? (
            <ol style={{ paddingInlineStart: 20, margin: 0 }}>
              {topic.hooks.map((hook) => (
                <li key={hook}>
                  <Space size={4} align="start">
                    <ContentText>{hook}</ContentText>
                    <Tooltip title="Copy hook">
                      <Button
                        type="text"
                        size="small"
                        icon={<CopyOutlined />}
                        aria-label="Copy hook"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(hook);
                            message.success('Hook copied');
                          } catch {
                            message.error(
                              "Couldn't copy. Select the text instead.",
                            );
                          }
                        }}
                      />
                    </Tooltip>
                  </Space>
                </li>
              ))}
            </ol>
          ) : (
            <Typography.Text type="secondary">No hooks yet.</Typography.Text>
          )}
        </div>
        <Descriptions column={1} size="small">
          <Descriptions.Item label="Formats">
            {topic.suggested_formats.length ? (
              <FormatTags formats={topic.suggested_formats} />
            ) : (
              'Any format'
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Keywords">
            {topic.keywords.length
              ? topic.keywords.map((keyword) => (
                  <Tag key={keyword}>
                    <ContentText>{keyword}</ContentText>
                  </Tag>
                ))
              : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Origin">
            {topic.origin === 'ai' ? 'AI' : 'Manual'}
          </Descriptions.Item>
          <Descriptions.Item label="Plan">
            {plan
              ? planLabel(plan)
              : topic.plan
                ? `Plan #${topic.plan}`
                : 'No plan'}
          </Descriptions.Item>
          <Descriptions.Item label="Found">
            <DateTime value={topic.created_at} />
          </Descriptions.Item>
        </Descriptions>
        <Divider style={{ margin: 0 }} />
        <div>
          <Typography.Title level={5}>Evidence</Typography.Title>
          <EvidenceBars topic={topic} />
        </div>
        <div>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Typography.Title level={5} style={{ margin: 0 }}>
              Signals
            </Typography.Title>
            {canEdit ? (
              <Button size="small" onClick={() => setAttachOpen(true)}>
                Attach signals
              </Button>
            ) : null}
          </Space>
          {topic.signals.length ? (
            <List
              dataSource={topic.signals}
              renderItem={(s) => <SignalItem signal={s} />}
            />
          ) : (
            <Empty
              description="No signals attached."
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          )}
        </div>
      </Space>
    );
  }

  return (
    <Drawer
      open={topicId !== null}
      size={640}
      onClose={close}
      destroyOnHidden
      title={
        topic ? (
          <Space size={8} wrap>
            <ContentText strong>{topic.title}</ContentText>
            <StatusTag kind="topic" status={topic.status} />
          </Space>
        ) : (
          'Topic'
        )
      }
      extra={
        topic && canEdit && !editing ? (
          <Space size={4} wrap>
            {topicActions(topic.status).map((action) => (
              <Button
                key={action.key}
                size="small"
                onClick={() => changeTopicStatus(topic, action, refresh)}
              >
                {action.label}
              </Button>
            ))}
            <Button
              size="small"
              type="primary"
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
          </Space>
        ) : null
      }
    >
      {topic?.status === 'used' ? (
        <Alert
          type="info"
          showIcon
          title="This topic is in use by a content item and can no longer change."
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {body}
      {topic ? (
        <AttachSignalsModal
          open={attachOpen}
          accountId={account.id}
          topicId={topic.id}
          topicStatus={topic.status}
          linkedIds={topic.signals.map((s) => s.id)}
          onClose={() => setAttachOpen(false)}
          onSaved={refresh}
          onConflict={refresh}
        />
      ) : null}
    </Drawer>
  );
};

export default TopicDrawer;
