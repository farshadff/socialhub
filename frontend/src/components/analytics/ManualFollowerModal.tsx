import { useMutation } from '@tanstack/react-query';
import { Alert, Checkbox, DatePicker, Form, InputNumber, Modal, Space, message } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import React, { useEffect, useState } from 'react';
import { createFollowerSnapshot, type AccountAnalyticsPoint } from '@/services/socialhub/analytics';
import { isApiError } from '@/services/socialhub/http';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { notifyError } from '@/utils/errorText';

dayjs.extend(timezone);

type FollowerForm = {
  date: Dayjs;
  followers: number;
  following?: number;
  media_count?: number;
  replace?: boolean;
};

const ManualFollowerModal: React.FC<{
  open: boolean;
  timezoneName: string;
  existing?: AccountAnalyticsPoint | null;
  onCancel: () => void;
  onSaved: () => void;
}> = ({ open, timezoneName, existing, onCancel, onSaved }) => {
  const [form] = Form.useForm<FollowerForm>();
  const [fieldMessages, setFieldMessages] = useState<string[]>([]);
  const mutation = useMutation({
    mutationFn: (body: Parameters<typeof createFollowerSnapshot>[0]) => createFollowerSnapshot(body),
    onSuccess: (result) => {
      message.success(result.replaced ? 'Follower count replaced' : 'Follower count saved');
      onSaved();
    },
    onError: (error) => {
      const unmatched = applyFieldErrors(form, error);
      if (isApiError(error) && error.fields.length) {
        setFieldMessages(unmatched);
        return;
      }
      notifyError(error);
    },
  });
  useEffect(() => {
    if (!open) return;
    form.resetFields();
    setFieldMessages([]);
    form.setFieldsValue({
      date: existing ? dayjs(existing.date) : dayjs(),
      followers: existing?.followers,
      following: existing?.following ?? undefined,
      media_count: existing?.media_count ?? undefined,
      replace: false,
    });
  }, [open, existing?.date]);

  const save = (values: FollowerForm) => {
    mutation.mutate({
      date: values.date.format('YYYY-MM-DD'),
      followers: values.followers,
      following: values.following,
      media_count: values.media_count,
      replace: Boolean(values.replace),
    });
  };
  const accountToday = dayjs().tz(timezoneName).format('YYYY-MM-DD');
  const oldestDate = dayjs().tz(timezoneName).subtract(400, 'day').format('YYYY-MM-DD');

  return (
    <Modal title="Enter follower count" open={open} onCancel={onCancel} onOk={() => form.submit()} confirmLoading={mutation.isPending} okText="Save count" destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item name="date" label={`Snapshot date (${timezoneName})`} rules={[{ required: true }]}><DatePicker format="D MMM YYYY" style={{ width: '100%' }} disabledDate={(date) => { const value = date.format('YYYY-MM-DD'); return value > accountToday || value < oldestDate; }} /></Form.Item>
        <Form.Item name="followers" label="Followers" rules={[{ required: true }, { type: 'number', min: 0, max: 2_000_000_000 }]}><InputNumber min={0} max={2_000_000_000} precision={0} style={{ width: '100%' }} /></Form.Item>
        <Space style={{ width: '100%' }}>
          <Form.Item name="following" label="Following"><InputNumber min={0} max={2_000_000_000} precision={0} /></Form.Item>
          <Form.Item name="media_count" label="Media count"><InputNumber min={0} max={2_000_000_000} precision={0} /></Form.Item>
        </Space>
        <Form.Item name="replace" valuePropName="checked"><Checkbox>Replace an existing provider snapshot</Checkbox></Form.Item>
        {fieldMessages.length ? <Alert type="error" showIcon title={fieldMessages.join(' ')} /> : null}
      </Form>
    </Modal>
  );
};

export default ManualFollowerModal;
