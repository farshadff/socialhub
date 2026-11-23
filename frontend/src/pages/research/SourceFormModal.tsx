import {
  ModalForm,
  ProFormDependency,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
} from '@ant-design/pro-components';
import { Alert, Form, message } from 'antd';
import React, { useState } from 'react';
import type { Account } from '@/services/socialhub/accounts';
import {
  createSource,
  type ResearchSource,
  type SourceKind,
  updateSource,
} from '@/services/socialhub/research';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { notifyError } from '@/utils/errorText';
import { limitReachedText } from './constants';
import { normalizeSourceValue, validateSourceValue } from './sourceRules';

type Values = {
  kind: SourceKind;
  value: string;
  label?: string;
  active: boolean;
};

const VALUE_COPY: Record<SourceKind, { label: string; placeholder: string }> = {
  web_search: {
    label: 'Search query',
    placeholder: 'e.g. specialty coffee trends',
  },
  rss: { label: 'Feed address', placeholder: 'https://example.com/feed/' },
};

export type SourceFormModalProps = {
  open: boolean;
  account: Account;
  /** The source to edit; null to add one. */
  source: ResearchSource | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (source: ResearchSource) => void;
};

/** Add or edit a research source (E02-S01 Panel). */
const SourceFormModal: React.FC<SourceFormModalProps> = ({
  open,
  account,
  source,
  onOpenChange,
  onSaved,
}) => {
  const [form] = Form.useForm<Values>();
  const [formError, setFormError] = useState<string[]>([]);
  const editing = source !== null;

  return (
    <ModalForm<Values>
      title={editing ? 'Edit source' : 'Add source'}
      open={open}
      form={form}
      onOpenChange={(next) => {
        if (!next) setFormError([]);
        onOpenChange(next);
      }}
      modalProps={{ destroyOnHidden: true }}
      submitter={{ searchConfig: { submitText: 'Save', resetText: 'Cancel' } }}
      initialValues={
        source
          ? {
              kind: source.kind,
              value: source.value,
              label: source.label,
              active: source.active,
            }
          : { kind: 'web_search', value: '', label: '', active: true }
      }
      onFinish={async (values) => {
        setFormError([]);
        const kind = source?.kind ?? values.kind;
        const value = normalizeSourceValue(kind, values.value);
        const label = (values.label ?? '').trim();
        try {
          const saved = source
            ? await updateSource(source.id, {
                value,
                label,
                active: values.active,
              })
            : await createSource({
                account: account.id,
                kind,
                value,
                label,
                active: values.active,
              });
          message.success('Source saved');
          onSaved(saved);
          return true;
        } catch (error) {
          const unmatched = applyFieldErrors(form, error, (field) => {
            if (field.path === 'active' && field.code === 'limit_reached') {
              return limitReachedText(kind);
            }
            if (field.path === 'value' && field.code === 'unique') {
              return 'This value already exists.';
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
      <ProFormSelect
        name="kind"
        label="Kind"
        disabled={editing}
        allowClear={false}
        rules={[{ required: true, message: 'Choose a kind.' }]}
        options={[
          { value: 'web_search', label: 'Web search' },
          { value: 'rss', label: 'RSS feed' },
        ]}
        fieldProps={{
          onChange: () => form.setFields([{ name: 'value', errors: [] }]),
        }}
      />
      <ProFormDependency name={['kind']}>
        {({ kind }) => {
          const current: SourceKind = kind ?? 'web_search';
          return (
            <ProFormText
              name="value"
              label={VALUE_COPY[current].label}
              placeholder={VALUE_COPY[current].placeholder}
              rules={[
                {
                  validator: async (_, raw: string) => {
                    const problem = validateSourceValue(current, raw ?? '');
                    if (problem) throw new Error(problem);
                  },
                },
              ]}
            />
          );
        }}
      </ProFormDependency>
      <ProFormText
        name="label"
        label="Label"
        extra="Shown in lists. Leave empty to use the value."
        rules={[{ max: 80, message: 'Use at most 80 characters.' }]}
      />
      <ProFormSwitch name="active" label="Active" />
    </ModalForm>
  );
};

export default SourceFormModal;
