import {
  ModalForm,
  ProFormDateTimePicker,
  ProFormDigit,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import { Alert, Button, Form, message, Space } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import React, { useState } from 'react';
import ContentText from '@/components/ContentText';
import type { Account } from '@/services/socialhub/accounts';
import { isApiError } from '@/services/socialhub/http';
import {
  createSignal,
  listTopics,
  type SignalMetrics,
  type TrendSignal,
} from '@/services/socialhub/research';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { notifyError } from '@/utils/errorText';

dayjs.extend(utc);
dayjs.extend(timezone);

type Values = {
  url?: string;
  title: string;
  excerpt?: string;
  author?: string;
  published_at?: Dayjs | null;
  likes?: number | null;
  comments?: number | null;
  views?: number | null;
  topic?: number | null;
};

export type SignalFormModalProps = {
  open: boolean;
  account: Account;
  onOpenChange: (open: boolean) => void;
  onCreated: (signal: TrendSignal) => void;
  /** "Show it": filter the table to the signal that already has this link. */
  onShowExisting: (signalId: number) => void;
};

/** "Add signal": a manual signal, for example an Instagram post found by hand (E02-S02 rules 36–40). */
const SignalFormModal: React.FC<SignalFormModalProps> = ({
  open,
  account,
  onOpenChange,
  onCreated,
  onShowExisting,
}) => {
  const [form] = Form.useForm<Values>();
  const [duplicateOf, setDuplicateOf] = useState<number | null>(null);
  const [formError, setFormError] = useState<string[]>([]);

  const reset = () => {
    setDuplicateOf(null);
    setFormError([]);
  };

  return (
    <ModalForm<Values>
      title="Add signal"
      open={open}
      form={form}
      width={600}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      modalProps={{ destroyOnHidden: true }}
      submitter={{ searchConfig: { submitText: 'Save', resetText: 'Cancel' } }}
      onFinish={async (values) => {
        reset();
        const metrics: SignalMetrics = {};
        for (const key of ['likes', 'comments', 'views'] as const) {
          const value = values[key];
          if (typeof value === 'number') metrics[key] = value;
        }
        try {
          const signal = await createSignal({
            account: account.id,
            url: values.url?.trim() || undefined,
            title: values.title.trim(),
            excerpt: values.excerpt?.trim() || undefined,
            author: values.author?.trim() || undefined,
            published_at: values.published_at
              ? dayjs
                  .tz(
                    values.published_at.format('YYYY-MM-DDTHH:mm:ss'),
                    account.timezone,
                  )
                  .toISOString()
              : null,
            metrics,
            topic: values.topic ?? null,
          });
          message.success('Signal added');
          onCreated(signal);
          return true;
        } catch (error) {
          if (
            isApiError(error) &&
            error.fields.some((f) => f.code === 'unique') &&
            error.details.signal_id
          ) {
            setDuplicateOf(Number(error.details.signal_id));
            return false;
          }
          const unmatched = applyFieldErrors(form, error);
          if (unmatched.length) setFormError(unmatched);
          else if (
            !form.getFieldsError().some((entry) => entry.errors.length)
          ) {
            notifyError(error);
          }
          return false;
        }
      }}
    >
      {duplicateOf !== null ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title="This link is already saved as a signal."
          action={
            <Button
              size="small"
              type="link"
              onClick={() => {
                onShowExisting(duplicateOf);
                onOpenChange(false);
              }}
            >
              Show it
            </Button>
          }
        />
      ) : null}
      {formError.length ? (
        <Alert
          type="error"
          showIcon
          title={formError.join(' ')}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <ProFormText
        name="url"
        label="Link"
        placeholder="https://"
        rules={[
          {
            pattern: /^https?:\/\/\S+$/i,
            message: 'Start the link with http:// or https://.',
          },
          { max: 2000, message: 'Use at most 2,000 characters.' },
        ]}
      />
      <ProFormText
        name="title"
        label="Title"
        fieldProps={{ dir: 'auto' }}
        rules={[
          { required: true, whitespace: true, message: 'Enter a title.' },
          { max: 300, message: 'Use at most 300 characters.' },
        ]}
      />
      <ProFormTextArea
        name="excerpt"
        label="What it shows"
        fieldProps={{ dir: 'auto', rows: 3 }}
        dependencies={['url']}
        rules={[
          { max: 1000, message: 'Use at most 1,000 characters.' },
          ({ getFieldValue }: { getFieldValue: (name: string) => any }) => ({
            validator: async (_: unknown, value?: string) => {
              if (!getFieldValue('url')?.trim() && !value?.trim()) {
                throw new Error('Describe what it shows, or add a link.');
              }
            },
          }),
        ]}
      />
      <ProFormText
        name="author"
        label="Author or publisher"
        fieldProps={{ dir: 'auto' }}
        rules={[{ max: 120, message: 'Use at most 120 characters.' }]}
      />
      <ProFormDateTimePicker
        name="published_at"
        label="Published on"
        extra={`In the account's timezone (${account.timezone}).`}
        fieldProps={{ format: 'D MMM YYYY, HH:mm' }}
      />
      <Space size={16} wrap>
        <ProFormDigit
          name="likes"
          label="Likes"
          min={0}
          fieldProps={{ precision: 0 }}
        />
        <ProFormDigit
          name="comments"
          label="Comments"
          min={0}
          fieldProps={{ precision: 0 }}
        />
        <ProFormDigit
          name="views"
          label="Views"
          min={0}
          fieldProps={{ precision: 0 }}
        />
      </Space>
      <ProFormSelect
        name="topic"
        label="Attach to topic"
        placeholder="No topic"
        showSearch
        request={async () => {
          const page = await listTopics({
            account: account.id,
            status: ['new', 'shortlisted'],
            page_size: 100,
          });
          return page.results.map((topic) => ({
            value: topic.id,
            label: <ContentText>{topic.title}</ContentText>,
            title: topic.title,
          }));
        }}
      />
    </ModalForm>
  );
};

export default SignalFormModal;
