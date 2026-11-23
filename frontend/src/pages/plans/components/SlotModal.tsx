import { Alert, DatePicker, Form, Input, Modal, Select, TimePicker } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import React, { useEffect, useState } from 'react';
import type { Account } from '@/services/socialhub/accounts';
import { isApiError } from '@/services/socialhub/http';
import {
  createSlot,
  type Format,
  type Plan,
  type Role,
  type Slot,
  updateSlot,
} from '@/services/socialhub/plans';
import { notifyError } from '@/utils/errorText';
import { FORMATS, planFieldText, ROLES, SLOT_PERMISSIONS } from '../shared';

type Values = {
  date: Dayjs;
  time: Dayjs;
  format: Format;
  role?: Role | null;
  note?: string;
};

export type SlotModalProps = {
  plan: Plan;
  account: Account;
  /** null: add a slot; a slot: edit it. */
  slot: Slot | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onConflict: () => void;
};

/** Add or edit one slot in account-local date and time (E01-S02). */
const SlotModal: React.FC<SlotModalProps> = ({
  plan,
  account,
  slot,
  open,
  onClose,
  onSaved,
  onConflict,
}) => {
  const [form] = Form.useForm<Values>();
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const can = SLOT_PERMISSIONS[slot?.status ?? 'open'];

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    form.resetFields();
    form.setFieldsValue(
      slot
        ? {
            date: dayjs(slot.local_date),
            time: dayjs(`${slot.local_date}T${slot.local_time}`),
            format: slot.format,
            role: slot.role,
            note: slot.note,
          }
        : { date: dayjs(plan.week_start), format: 'reel', role: null, note: '' },
    );
  }, [open, slot, plan.week_start, form]);

  const submit = async () => {
    let values: Values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const body = {
      local_date: values.date.format('YYYY-MM-DD'),
      local_time: values.time.format('HH:mm'),
      format: values.format,
      role: values.role ?? null,
      note: values.note ?? '',
    };
    setSaving(true);
    setFormError(null);
    try {
      if (slot) {
        const { local_date, local_time, format, ...rest } = body;
        await updateSlot(slot.id, {
          ...rest,
          ...(can.time ? { local_date, local_time } : {}),
          ...(can.format ? { format } : {}),
        });
      } else {
        await createSlot(plan.id, body);
      }
      onSaved();
      onClose();
    } catch (error) {
      if (isApiError(error) && error.status === 409) {
        notifyError(error);
        onConflict();
        onClose();
      } else if (isApiError(error) && error.code === 'validation_error') {
        const unmatched: string[] = [];
        const byField: Record<string, string[]> = {};
        for (const field of error.fields) {
          const text = planFieldText(field, account, values.format);
          const name =
            field.path === 'scheduled_at' || field.path === 'local_time'
              ? 'time'
              : field.path === 'local_date'
                ? 'date'
                : ['format', 'role', 'note'].includes(field.path)
                  ? field.path
                  : null;
          if (name) {
            byField[name] = [...(byField[name] ?? []), text];
          } else {
            unmatched.push(text);
          }
        }
        form.setFields(
          Object.entries(byField).map(([name, errors]) => ({
            name: name as keyof Values,
            errors,
          })),
        );
        setFormError(unmatched.length ? unmatched.join(' ') : null);
      } else {
        notifyError(error);
      }
    } finally {
      setSaving(false);
    }
  };

  const start = dayjs(plan.week_start);
  const end = dayjs(plan.week_end);

  return (
    <Modal
      title={slot ? 'Edit slot' : 'Add slot'}
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText={slot ? 'Save slot' : 'Add slot'}
      confirmLoading={saving}
      destroyOnHidden
    >
      {formError && <Alert type="error" showIcon title={formError} style={{ marginBottom: 16 }} />}
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          name="date"
          label="Date"
          rules={[{ required: true, message: 'Pick a date.' }]}
          extra={`Times are in ${account.timezone}.`}
        >
          <DatePicker
            format="ddd D MMM YYYY"
            disabled={!can.time}
            style={{ width: '100%' }}
            disabledDate={(date) => date.isBefore(start, 'day') || date.isAfter(end, 'day')}
            defaultPickerValue={start}
          />
        </Form.Item>
        <Form.Item name="time" label="Time" rules={[{ required: true, message: 'Pick a time.' }]}>
          <TimePicker
            format="HH:mm"
            minuteStep={5}
            disabled={!can.time}
            needConfirm={false}
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Form.Item name="format" label="Format" rules={[{ required: true }]}>
          <Select options={FORMATS} disabled={!can.format} />
        </Form.Item>
        <Form.Item name="role" label="Role">
          <Select
            allowClear
            placeholder="No role"
            disabled={!can.role}
            options={ROLES.map((role) => ({
              value: role.value,
              label: `${role.label} — ${role.help}`,
            }))}
          />
        </Form.Item>
        <Form.Item name="note" label="Note">
          <Input.TextArea rows={2} maxLength={500} dir="auto" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default SlotModal;
