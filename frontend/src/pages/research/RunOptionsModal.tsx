import {
  ModalForm,
  ProFormCheckbox,
  ProFormDigit,
  ProFormSelect,
} from '@ant-design/pro-components';
import { Form } from 'antd';
import React from 'react';
import type { Account } from '@/services/socialhub/accounts';
import { listSources, type StartRunBody } from '@/services/socialhub/research';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { notifyError } from '@/utils/errorText';
import { KIND_LABEL } from './constants';

type Values = {
  lookback_days: number;
  source_ids?: number[];
  collect: boolean;
  synthesize: boolean;
};

export type RunOptionsModalProps = {
  open: boolean;
  account: Account;
  onOpenChange: (open: boolean) => void;
  /** Starts the run; resolves true when the modal can close. Throws an API error otherwise. */
  onSubmit: (options: Partial<StartRunBody>) => Promise<boolean>;
};

/** "Run with options…" (E02-S02 Panel). */
const RunOptionsModal: React.FC<RunOptionsModalProps> = ({
  open,
  account,
  onOpenChange,
  onSubmit,
}) => {
  const [form] = Form.useForm<Values>();
  return (
    <ModalForm<Values>
      title="Run research"
      open={open}
      form={form}
      onOpenChange={onOpenChange}
      modalProps={{ destroyOnHidden: true }}
      submitter={{ searchConfig: { submitText: 'Run', resetText: 'Cancel' } }}
      initialValues={{ lookback_days: 7, collect: true, synthesize: true }}
      onFinish={async (values) => {
        if (!values.collect && !values.synthesize) {
          form.setFields([
            {
              name: 'synthesize',
              errors: ['Choose at least one of the two steps.'],
            },
          ]);
          return false;
        }
        try {
          return await onSubmit({
            lookback_days: values.lookback_days,
            collect: values.collect,
            synthesize: values.synthesize,
            ...(values.source_ids?.length
              ? { source_ids: values.source_ids }
              : {}),
          });
        } catch (error) {
          const unmatched = applyFieldErrors(form, error);
          if (
            unmatched.length ||
            !form.getFieldsError().some((f) => f.errors.length)
          ) {
            notifyError(error);
          }
          return false;
        }
      }}
    >
      <ProFormDigit
        name="lookback_days"
        label="Look back"
        min={1}
        max={30}
        fieldProps={{ precision: 0, suffix: 'days' }}
        rules={[{ required: true, message: 'Enter 1 to 30 days.' }]}
      />
      <ProFormSelect
        name="source_ids"
        label="Sources"
        mode="multiple"
        placeholder="All active sources"
        request={async () => {
          const page = await listSources({
            account: account.id,
            active: true,
            page_size: 100,
          });
          return page.results
            .filter((source) => source.available)
            .map((source) => ({
              value: source.id,
              label: `${source.label} (${KIND_LABEL[source.kind]})`,
            }));
        }}
      />
      <ProFormCheckbox name="collect">Collect new signals</ProFormCheckbox>
      <ProFormCheckbox name="synthesize">
        Group signals into topics
      </ProFormCheckbox>
    </ModalForm>
  );
};

export default RunOptionsModal;
