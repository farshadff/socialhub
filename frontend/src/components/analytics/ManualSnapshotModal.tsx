import { useMutation } from '@tanstack/react-query';
import { Alert, Checkbox, DatePicker, Form, InputNumber, Modal, Select, Space, message } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import React, { useEffect, useState } from 'react';
import type { AnalyticsCheckpoint, MetricSnapshot } from '@/services/socialhub/analytics';
import { createMetricSnapshot } from '@/services/socialhub/analytics';
import type { Metric } from '@/services/socialhub/plans';
import { isApiError } from '@/services/socialhub/http';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { notifyError } from '@/utils/errorText';
import { CHECKPOINT_LABEL } from './CheckpointTable';

dayjs.extend(utc);
dayjs.extend(timezone);

type SnapshotForm = Record<string, number | boolean | Dayjs | string | undefined> & {
  checkpoint: string;
  captured_at?: Dayjs;
  replace?: boolean;
};

const METRIC_LABEL: Record<Metric, string> = {
  reach: 'Reach', views: 'Views', likes: 'Likes', comments: 'Comments', saves: 'Saves', shares: 'Shares', replies: 'Replies', follower_growth: 'Follower growth',
};

const ManualSnapshotModal: React.FC<{
  open: boolean;
  publicationId: number;
  checkpoints: AnalyticsCheckpoint[];
  metrics: Metric[];
  timezoneName: string;
  defaultCheckpoint?: string;
  existing?: MetricSnapshot | null;
  onCancel: () => void;
  onSaved: () => void;
}> = ({ open, publicationId, checkpoints, metrics, timezoneName, defaultCheckpoint, existing, onCancel, onSaved }) => {
  const [form] = Form.useForm<SnapshotForm>();
  const [missingMetric, setMissingMetric] = useState(false);
  const [fieldMessages, setFieldMessages] = useState<string[]>([]);
  const mutation = useMutation({
    mutationFn: (body: Parameters<typeof createMetricSnapshot>[1]) => createMetricSnapshot(publicationId, body),
    onSuccess: (result) => {
      message.success(result.replaced ? 'Metrics replaced' : 'Metrics entered');
      setMissingMetric(false);
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
    const initial: SnapshotForm = { checkpoint: existing?.checkpoint ?? defaultCheckpoint ?? checkpoints.find((point) => ['due', 'overdue', 'skipped'].includes(point.status))?.checkpoint ?? checkpoints[0]?.checkpoint ?? 'adhoc', replace: false };
    for (const metric of metrics) {
      const value = existing?.[metric];
      if (typeof value === 'number') initial[metric] = value;
    }
    form.resetFields();
    form.setFieldsValue(initial);
    setMissingMetric(false);
    setFieldMessages([]);
  }, [open, publicationId, defaultCheckpoint, existing?.id]);

  const save = (values: SnapshotForm) => {
    const body: Parameters<typeof createMetricSnapshot>[1] = { checkpoint: values.checkpoint, replace: Boolean(values.replace) };
    const capturedAt = values.captured_at?.format('YYYY-MM-DD HH:mm');
    if (capturedAt) body.captured_at = dayjs.tz(capturedAt, timezoneName).utc().toISOString();
    let supplied = false;
    for (const metric of metrics) {
      const value = values[metric];
      if (typeof value === 'number' && metric !== 'follower_growth') {
        body[metric] = value;
        supplied = true;
      }
    }
    if (!supplied) {
      setMissingMetric(true);
      return;
    }
    setMissingMetric(false);
    setFieldMessages([]);
    mutation.mutate(body);
  };

  return (
    <Modal title="Enter post metrics" open={open} onCancel={onCancel} onOk={() => form.submit()} confirmLoading={mutation.isPending} okText="Save metrics" destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item name="checkpoint" label="Checkpoint" rules={[{ required: true }]}>
          <Select options={[
            ...checkpoints.map((point) => ({ value: point.checkpoint, label: CHECKPOINT_LABEL[point.checkpoint] ?? point.checkpoint })),
            ...(!checkpoints.some((point) => point.checkpoint === 'adhoc') ? [{ value: 'adhoc', label: 'Ad hoc' }] : []),
          ]} />
        </Form.Item>
        <Form.Item name="captured_at" label={`Numbers read at (${timezoneName})`}><DatePicker showTime format="D MMM YYYY, HH:mm" style={{ width: '100%' }} /></Form.Item>
        <Space wrap style={{ width: '100%' }}>
          {metrics.map((metric) => <Form.Item key={metric} name={metric} label={METRIC_LABEL[metric]}><InputNumber min={0} max={2_000_000_000} precision={0} style={{ width: '100%' }} /></Form.Item>)}
        </Space>
        <Form.Item name="replace" valuePropName="checked"><Checkbox>Replace an existing provider snapshot</Checkbox></Form.Item>
        {missingMetric ? <Alert type="error" showIcon title="Enter at least one metric." /> : null}
        {fieldMessages.length ? <Alert type="error" showIcon title={fieldMessages.join(' ')} /> : null}
      </Form>
    </Modal>
  );
};

export default ManualSnapshotModal;
