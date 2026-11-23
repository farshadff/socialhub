import {
  ModalForm,
  ProFormDependency,
  ProFormDigit,
  ProFormRadio,
  ProFormSwitch,
  ProFormText,
} from '@ant-design/pro-components';
import { Alert, Form, message, Typography } from 'antd';
import React, { useState } from 'react';
import type { Account } from '@/services/socialhub/accounts';
import {
  createFeedSource,
  type FeedFieldPaths,
  type FeedSource,
  type FeedSourceKind,
  updateFeedSource,
} from '@/services/socialhub/feeds';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { notifyError } from '@/utils/errorText';

type Values = {
  kind: Exclude<FeedSourceKind, 'manual'>;
  name: string;
  url: string;
  config: {
    auto_eligible: boolean;
    max_age_days: number;
    items_path?: string;
    fields?: Partial<FeedFieldPaths>;
    auth_header_env?: string;
  };
};

const FIELD_INPUTS: {
  key: keyof FeedFieldPaths;
  label: string;
  placeholder: string;
  required?: boolean;
}[] = [
  { key: 'external_id', label: 'ID', placeholder: 'id', required: true },
  { key: 'title', label: 'Title', placeholder: 'name', required: true },
  { key: 'summary', label: 'Summary', placeholder: 'description' },
  { key: 'url', label: 'Link', placeholder: 'links.web' },
  { key: 'image_url', label: 'Image link', placeholder: 'images.0.url' },
  { key: 'published_at', label: 'Published date', placeholder: 'created_at' },
];

const DOT_PATH = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;

/** Builds the request body; empty optional paths are left out (E03-S01 rule 6). */
export function toSourceBody(values: Values) {
  const config: Record<string, unknown> = {
    auto_eligible: values.config.auto_eligible,
    max_age_days: values.config.max_age_days,
  };
  if (values.kind === 'json_api') {
    config.items_path = (values.config.items_path ?? '').trim();
    const fields: Record<string, string> = {};
    for (const { key } of FIELD_INPUTS) {
      const value = (values.config.fields?.[key] ?? '').trim();
      if (value) fields[key] = value;
    }
    config.fields = fields;
    const env = (values.config.auth_header_env ?? '').trim();
    if (env) config.auth_header_env = env;
  }
  return {
    name: values.name.trim(),
    url: values.url.trim(),
    config,
  };
}

export type FeedSourceFormModalProps = {
  open: boolean;
  account: Account;
  /** The source to edit; null to add one. */
  source: FeedSource | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (source: FeedSource, created: boolean) => void;
};

/** Add or edit a feed source (E03-S01 Panel). */
const FeedSourceFormModal: React.FC<FeedSourceFormModalProps> = ({
  open,
  account,
  source,
  onOpenChange,
  onSaved,
}) => {
  const [form] = Form.useForm<Values>();
  const [formError, setFormError] = useState<string[]>([]);
  const editing = source !== null;

  const initialValues: Values = source
    ? {
        kind: source.kind === 'json_api' ? 'json_api' : 'rss',
        name: source.name,
        url: source.url,
        config: {
          auto_eligible: source.config.auto_eligible,
          max_age_days: source.config.max_age_days,
          items_path: source.config.items_path ?? '',
          fields: { ...(source.config.fields ?? {}) },
          auth_header_env: source.config.auth_header_env ?? '',
        },
      }
    : {
        kind: 'rss',
        name: '',
        url: '',
        config: {
          auto_eligible: true,
          max_age_days: 14,
          items_path: '',
          fields: {},
        },
      };

  return (
    <ModalForm<Values>
      title={source ? `Edit ${source.name}` : 'Add source'}
      open={open}
      form={form}
      width={640}
      onOpenChange={(next) => {
        if (!next) setFormError([]);
        onOpenChange(next);
      }}
      modalProps={{ destroyOnHidden: true }}
      submitter={{ searchConfig: { submitText: 'Save', resetText: 'Cancel' } }}
      initialValues={initialValues}
      onFinish={async (values) => {
        setFormError([]);
        const body = toSourceBody(values);
        try {
          const saved = source
            ? await updateFeedSource(source.id, body)
            : await createFeedSource({
                ...body,
                account: account.id,
                kind: values.kind,
                active: true,
              });
          message.success(editing ? 'Source saved' : 'Source added');
          onSaved(saved, !editing);
          return true;
        } catch (error) {
          const unmatched = applyFieldErrors(form, error, (field) => {
            if (field.path === 'name' && field.code === 'unique') {
              return 'Another source already uses this name.';
            }
            if (field.path === 'account' && field.code === 'limit_reached') {
              return 'An account can have at most 20 feed sources. Delete one first.';
            }
            if (
              field.path === 'config.auth_header_env' &&
              field.code === 'invalid'
            ) {
              return 'The variable name must start with SOCIALHUB_FEED_.';
            }
            return undefined;
          });
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
      <ProFormRadio.Group
        name="kind"
        label="Kind"
        disabled={editing}
        radioType="button"
        options={[
          { value: 'rss', label: 'RSS or Atom feed' },
          { value: 'json_api', label: 'JSON endpoint' },
        ]}
      />
      <ProFormText
        name="name"
        label="Name"
        placeholder="Company blog"
        rules={[
          { required: true, whitespace: true, message: 'Enter a name.' },
          { max: 80, message: 'Use at most 80 characters.' },
        ]}
      />
      <ProFormText
        name="url"
        label="Link"
        placeholder="https://example.com/blog/rss.xml"
        rules={[
          { required: true, whitespace: true, message: 'Enter the feed link.' },
          { max: 500, message: 'Use at most 500 characters.' },
          {
            pattern: /^https?:\/\/\S+$/,
            message: 'Enter a link that starts with http:// or https://.',
          },
        ]}
      />
      <ProFormSwitch
        name={['config', 'auto_eligible']}
        label="Make new items eligible automatically"
      />
      <ProFormDigit
        name={['config', 'max_age_days']}
        label="Only items newer than"
        min={1}
        max={365}
        fieldProps={{ precision: 0, suffix: 'days' }}
        width="xs"
        extra="Older items arrive as New and wait for you to mark them eligible."
        rules={[{ required: true, message: 'Enter a number of days.' }]}
      />
      <ProFormDependency name={['kind']}>
        {({ kind }) =>
          kind === 'json_api' ? (
            <>
              <Typography.Title level={5} style={{ marginTop: 8 }}>
                Field mapping
              </Typography.Title>
              <Typography.Paragraph type="secondary">
                Dot paths into the response, for example <code>data.items</code>{' '}
                or <code>images.0.url</code>.
              </Typography.Paragraph>
              <ProFormText
                name={['config', 'items_path']}
                label="Items path"
                placeholder="data.items"
                extra="Leave empty when the response itself is the list of items."
                rules={[
                  {
                    validator: async (_, value: string) => {
                      if (value && !DOT_PATH.test(value.trim())) {
                        throw new Error('Use a dot path such as data.items.');
                      }
                    },
                  },
                ]}
              />
              {FIELD_INPUTS.map((input) => (
                <ProFormText
                  key={input.key}
                  name={['config', 'fields', input.key]}
                  label={input.label}
                  placeholder={input.placeholder}
                  rules={[
                    ...(input.required
                      ? [
                          {
                            required: true,
                            whitespace: true,
                            message: `Enter the path to the ${input.label.toLowerCase()}.`,
                          },
                        ]
                      : []),
                    {
                      validator: async (_: unknown, value: string) => {
                        if (value && !DOT_PATH.test(value.trim())) {
                          throw new Error('Use a dot path such as links.web.');
                        }
                      },
                    },
                  ]}
                />
              ))}
              <ProFormText
                name={['config', 'auth_header_env']}
                label="Auth header variable"
                placeholder="SOCIALHUB_FEED_CATALOGUE_AUTH"
                extra="Name of a server environment variable holding one header, for example SOCIALHUB_FEED_CATALOGUE_AUTH. Ask an admin to set it."
                rules={[
                  {
                    pattern: /^(SOCIALHUB_FEED_[A-Z0-9_]+)?$/,
                    message:
                      'The variable name must start with SOCIALHUB_FEED_.',
                  },
                ]}
              />
            </>
          ) : null
        }
      </ProFormDependency>
    </ModalForm>
  );
};

export default FeedSourceFormModal;
