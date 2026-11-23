import {
  ModalForm,
  ProFormCheckbox,
  ProFormSelect,
  ProFormText,
} from '@ant-design/pro-components';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { history } from '@umijs/max';
import { Alert, Form, message } from 'antd';
import React, { useMemo, useState } from 'react';
import type { Account } from '@/services/socialhub/accounts';
import { isApiError } from '@/services/socialhub/http';
import {
  createPlan,
  duplicatePlan,
  getSlotTemplate,
  listPlanRows,
  type Plan,
} from '@/services/socialhub/plans';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { notifyError } from '@/utils/errorText';
import { planFieldText, weekRange, weekStartOptions } from '../shared';

type Values = {
  week_start: string;
  title?: string;
  generate_slots?: boolean;
  copy_slots?: boolean;
};

export type PlanWeekModalProps = {
  account: Account;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Set to copy this plan (E01-S03); otherwise the modal creates a new plan (E01-S01). */
  source?: Pick<Plan, 'id' | 'week_start'> | null;
};

/** "New plan" and "Duplicate" share the week picker and its rules. */
const PlanWeekModal: React.FC<PlanWeekModalProps> = ({
  account,
  open,
  onOpenChange,
  source,
}) => {
  const [form] = Form.useForm<Values>();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string[]>([]);
  const weeks = useMemo(() => weekStartOptions(account), [account]);

  const taken = useQuery({
    queryKey: [account.id, 'plans', 'taken-weeks', weeks[0]],
    queryFn: () =>
      listPlanRows({
        account: account.id,
        week_start_after: weeks[0],
        week_start_before: weeks[weeks.length - 1],
        page_size: 100,
      }),
    enabled: open,
  });
  const template = useQuery({
    queryKey: [account.id, 'slot-template'],
    queryFn: () => getSlotTemplate(account.id),
    enabled: open && !source,
  });

  const takenWeeks = new Set(
    (taken.data?.results ?? []).map((plan) => plan.week_start),
  );
  const hasTemplate = (template.data?.rows ?? []).some((row) => row.active);

  const defaultWeek = useMemo(() => {
    if (source) {
      const next = weeks.find((week) => week > source.week_start);
      return next && !takenWeeks.has(next) ? next : undefined;
    }
    return weeks.find((week) => !takenWeeks.has(week));
  }, [source, weeks, takenWeeks]);

  const submit = async (values: Values) => {
    setFormError([]);
    try {
      const plan = source
        ? await duplicatePlan(source.id, {
            week_start: values.week_start,
            copy_slots: values.copy_slots ?? true,
          })
        : await createPlan({
            account: account.id,
            week_start: values.week_start,
            title: values.title?.trim() || undefined,
            generate_slots: hasTemplate && (values.generate_slots ?? true),
          });
      await queryClient.invalidateQueries({ queryKey: [account.id, 'plans'] });
      message.success(
        source
          ? 'Plan copied. Review the goals and slots before activating.'
          : 'Plan created',
      );
      history.push(`/plans/${plan.id}`);
      return true;
    } catch (error) {
      if (isApiError(error) && error.code === 'validation_error') {
        setFormError(
          applyFieldErrors(form, error, (field) => planFieldText(field, account)),
        );
      } else {
        notifyError(error);
      }
      return false;
    }
  };

  return (
    <ModalForm<Values>
      title={source ? 'Duplicate plan' : 'New plan'}
      form={form}
      open={open}
      onOpenChange={(next) => {
        if (!next) setFormError([]);
        onOpenChange(next);
      }}
      modalProps={{ destroyOnHidden: true }}
      initialValues={{ generate_slots: true, copy_slots: true }}
      submitter={{
        searchConfig: { submitText: source ? 'Create copy' : 'Create plan' },
      }}
      onFinish={submit}
      key={defaultWeek ?? 'none'}
    >
      {formError.length > 0 && (
        <Alert type="error" showIcon title={formError.join(' ')} style={{ marginBottom: 16 }} />
      )}
      <ProFormSelect
        name="week_start"
        label="Week"
        initialValue={defaultWeek}
        rules={[{ required: true, message: 'Pick a week.' }]}
        fieldProps={{ loading: taken.isLoading }}
        options={weeks.map((week) => ({
          value: week,
          disabled: takenWeeks.has(week),
          label: takenWeeks.has(week)
            ? `${weekRange(week)} · Plan exists`
            : weekRange(week),
        }))}
      />
      {source ? (
        <ProFormCheckbox name="copy_slots">Copy slots</ProFormCheckbox>
      ) : (
        <>
          <ProFormText
            name="title"
            label="Title"
            placeholder="Week of …"
            fieldProps={{ maxLength: 120 }}
          />
          <ProFormCheckbox
            name="generate_slots"
            disabled={!hasTemplate}
            extra={!template.isLoading && !hasTemplate ? 'No slot template yet' : undefined}
          >
            Generate slots from template
          </ProFormCheckbox>
        </>
      )}
    </ModalForm>
  );
};

export default PlanWeekModal;
