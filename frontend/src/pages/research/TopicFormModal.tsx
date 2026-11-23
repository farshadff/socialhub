import { ModalForm, ProFormSelect } from '@ant-design/pro-components';
import { Alert, Form, message } from 'antd';
import React, { useState } from 'react';
import type { Account } from '@/services/socialhub/accounts';
import type { PlanSummary } from '@/services/socialhub/plans';
import {
  createTopic,
  type TrendTopicDetail,
} from '@/services/socialhub/research';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { notifyError } from '@/utils/errorText';
import { planLabel } from './constants';
import TopicFormFields, {
  cleanTopicValues,
  type TopicFormValues,
} from './TopicFormFields';

type Values = TopicFormValues & { plan: number | 'none' };

export type TopicFormModalProps = {
  open: boolean;
  account: Account;
  plans: PlanSummary[];
  defaultPlan: number | 'none' | null;
  onOpenChange: (open: boolean) => void;
  onCreated: (topic: TrendTopicDetail) => void;
};

/** "Add topic": a manual, shortlisted topic (E02-S04 rules 23–27). */
const TopicFormModal: React.FC<TopicFormModalProps> = ({
  open,
  account,
  plans,
  defaultPlan,
  onOpenChange,
  onCreated,
}) => {
  const [form] = Form.useForm<Values>();
  const [formError, setFormError] = useState<string[]>([]);

  return (
    <ModalForm<Values>
      title="Add topic"
      open={open}
      form={form}
      width={640}
      onOpenChange={(next) => {
        if (!next) setFormError([]);
        onOpenChange(next);
      }}
      modalProps={{ destroyOnHidden: true }}
      submitter={{ searchConfig: { submitText: 'Save', resetText: 'Cancel' } }}
      initialValues={{ plan: defaultPlan ?? 'none', hooks: [''] }}
      onFinish={async (values) => {
        setFormError([]);
        try {
          const topic = await createTopic({
            account: account.id,
            plan: values.plan === 'none' ? null : values.plan,
            ...cleanTopicValues(values),
          });
          message.success('Topic added to the shortlist');
          onCreated(topic);
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
      <ProFormSelect
        name="plan"
        label="Plan"
        allowClear={false}
        options={[
          ...plans
            .filter((plan) => plan.status !== 'closed')
            .map((plan) => ({ value: plan.id, label: planLabel(plan) })),
          { value: 'none', label: 'No plan' },
        ]}
      />
      <TopicFormFields />
    </ModalForm>
  );
};

export default TopicFormModal;
