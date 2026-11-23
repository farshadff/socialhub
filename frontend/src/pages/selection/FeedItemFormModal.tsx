import {
  ModalForm,
  ProFormDatePicker,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import { Alert, Form, message } from 'antd';
import type { Dayjs } from 'dayjs';
import React, { useState } from 'react';
import type { Account } from '@/services/socialhub/accounts';
import { createFeedItem, type FeedItem } from '@/services/socialhub/feeds';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { notifyError } from '@/utils/errorText';

type Values = {
  title: string;
  summary?: string;
  url?: string;
  image_url?: string;
  published_at?: Dayjs | string | null;
};

const LINK_RULE = {
  pattern: /^https?:\/\/\S+$/,
  message: 'Enter a link that starts with http:// or https://.',
};

export type FeedItemFormModalProps = {
  open: boolean;
  account: Account;
  onOpenChange: (open: boolean) => void;
  onSaved: (item: FeedItem) => void;
};

/** "Add item": a manual feed item, eligible at once (E03-S01 rule 19). */
const FeedItemFormModal: React.FC<FeedItemFormModalProps> = ({
  open,
  account,
  onOpenChange,
  onSaved,
}) => {
  const [form] = Form.useForm<Values>();
  const [formError, setFormError] = useState<string[]>([]);

  return (
    <ModalForm<Values>
      title="Add item"
      open={open}
      form={form}
      onOpenChange={(next) => {
        if (!next) setFormError([]);
        onOpenChange(next);
      }}
      modalProps={{ destroyOnHidden: true }}
      submitter={{
        searchConfig: { submitText: 'Add item', resetText: 'Cancel' },
      }}
      onFinish={async (values) => {
        setFormError([]);
        const published = values.published_at;
        try {
          const item = await createFeedItem({
            account: account.id,
            title: values.title.trim(),
            summary: (values.summary ?? '').trim(),
            url: (values.url ?? '').trim(),
            image_url: (values.image_url ?? '').trim(),
            published_at: published
              ? typeof published === 'string'
                ? published
                : published.startOf('day').toISOString()
              : null,
          });
          message.success('Item added');
          onSaved(item);
          return true;
        } catch (error) {
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
      {formError.length ? (
        <Alert
          type="error"
          showIcon
          title={formError.join(' ')}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <ProFormText
        name="title"
        label="Title"
        placeholder="New showroom opens on 5 December"
        fieldProps={{ dir: 'auto' }}
        rules={[
          { required: true, whitespace: true, message: 'Enter a title.' },
          { min: 3, message: 'Use at least 3 characters.' },
          { max: 300, message: 'Use at most 300 characters.' },
        ]}
      />
      <ProFormTextArea
        name="summary"
        label="Summary"
        fieldProps={{ dir: 'auto', showCount: true, maxLength: 2000, rows: 4 }}
      />
      <ProFormText
        name="url"
        label="Link"
        placeholder="https://example.com/news/showroom"
        rules={[LINK_RULE]}
      />
      <ProFormText name="image_url" label="Image link" rules={[LINK_RULE]} />
      <ProFormDatePicker
        name="published_at"
        label="Published date"
        width="sm"
      />
    </ModalForm>
  );
};

export default FeedItemFormModal;
