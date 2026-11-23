import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Col,
  Drawer,
  Form,
  message,
  Row,
  Select,
  Skeleton,
  Space,
  Switch,
  TimePicker,
  Typography,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import React, { useEffect, useState } from 'react';
import PageError from '@/components/PageError';
import type { Account } from '@/services/socialhub/accounts';
import { isApiError } from '@/services/socialhub/http';
import {
  type Format,
  getSlotTemplate,
  type Role,
  saveSlotTemplate,
} from '@/services/socialhub/plans';
import { notifyError } from '@/utils/errorText';
import { FORMATS, planFieldText, postingRulesText, ROLES, WEEKDAYS } from '../shared';

type RowValues = {
  weekday: number;
  time: Dayjs;
  format: Format;
  default_role: Role | null;
  active: boolean;
};

export type TemplateDrawerProps = {
  account: Account;
  open: boolean;
  intro?: string | null;
  onClose: () => void;
  onSaved: () => void;
};

/** The account's usual week (E01-S02 rules 1–4). */
const TemplateDrawer: React.FC<TemplateDrawerProps> = ({
  account,
  open,
  intro,
  onClose,
  onSaved,
}) => {
  const [form] = Form.useForm<{ rows: RowValues[] }>();
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const template = useQuery({
    queryKey: [account.id, 'slot-template'],
    queryFn: () => getSlotTemplate(account.id),
    enabled: open,
  });

  useEffect(() => {
    if (!open || !template.data) return;
    setFormError(null);
    form.setFieldsValue({
      rows: template.data.rows.map((row) => ({
        weekday: row.weekday,
        time: dayjs(`2000-01-01T${row.local_time}`),
        format: row.format,
        default_role: row.default_role,
        active: row.active,
      })),
    });
  }, [open, template.data, form]);

  const save = async () => {
    let values: { rows: RowValues[] };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const rows = (values.rows ?? []).map((row) => ({
      weekday: row.weekday,
      local_time: row.time.format('HH:mm'),
      format: row.format,
      default_role: row.default_role ?? null,
      active: row.active ?? true,
    }));
    setSaving(true);
    setFormError(null);
    try {
      await saveSlotTemplate(account.id, rows);
      await template.refetch();
      message.success('Template saved');
      onSaved();
      onClose();
    } catch (error) {
      if (isApiError(error) && error.code === 'validation_error') {
        const unmatched: string[] = [];
        const fields: Parameters<typeof form.setFields>[0] = [];
        for (const field of error.fields) {
          const match = /^rows\.(\d+)\.(\w+)$/.exec(field.path);
          const index = match ? Number(match[1]) : -1;
          const text = planFieldText(field, account, rows[index]?.format);
          if (match) {
            const column = (match[2] === 'local_time' ? 'time' : match[2]) as keyof RowValues;
            fields.push({ name: ['rows', index, column], errors: [text] });
          } else {
            unmatched.push(text);
          }
        }
        form.setFields(fields);
        setFormError(unmatched.length ? unmatched.join(' ') : null);
      } else {
        notifyError(error);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      title="Usual week"
      open={open}
      onClose={onClose}
      size="large"
      destroyOnHidden
      extra={
        <Button type="primary" loading={saving} onClick={save} disabled={!template.data}>
          Save template
        </Button>
      }
    >
      {intro && <Alert type="info" showIcon title={intro} style={{ marginBottom: 16 }} />}
      <Typography.Paragraph>
        {postingRulesText(account)} Times are in {account.timezone}.
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        Saving the template does not change existing plans. Use "Generate from template" on a
        plan to apply it.
      </Typography.Paragraph>
      {formError && <Alert type="error" showIcon title={formError} style={{ marginBottom: 16 }} />}
      {template.isLoading && <Skeleton active />}
      {template.isError && <PageError error={template.error} onRetry={template.refetch} />}
      {template.data && (
        <Form form={form} requiredMark={false}>
          <Form.List name="rows">
            {(fields, { add, remove }) => (
              <>
                {fields.length > 0 && (
                  <Row gutter={8} aria-hidden>
                    <Col span={6}><Typography.Text type="secondary">Weekday</Typography.Text></Col>
                    <Col span={4}><Typography.Text type="secondary">Time</Typography.Text></Col>
                    <Col span={5}><Typography.Text type="secondary">Format</Typography.Text></Col>
                    <Col span={5}><Typography.Text type="secondary">Default role</Typography.Text></Col>
                    <Col span={2}><Typography.Text type="secondary">Active</Typography.Text></Col>
                  </Row>
                )}
                {fields.map(({ key, name }) => (
                  <Row gutter={8} key={key}>
                    <Col span={6}>
                      <Form.Item name={[name, 'weekday']} rules={[{ required: true }]}>
                        <Select
                          aria-label="Weekday"
                          options={WEEKDAYS.map((label, value) => ({ label, value }))}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Form.Item
                        name={[name, 'time']}
                        rules={[{ required: true, message: 'Pick a time.' }]}
                      >
                        <TimePicker
                          aria-label="Time"
                          format="HH:mm"
                          minuteStep={5}
                          needConfirm={false}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={5}>
                      <Form.Item name={[name, 'format']} rules={[{ required: true }]}>
                        <Select aria-label="Format" options={FORMATS} />
                      </Form.Item>
                    </Col>
                    <Col span={5}>
                      <Form.Item name={[name, 'default_role']}>
                        <Select
                          aria-label="Default role"
                          allowClear
                          placeholder="None"
                          options={ROLES.map(({ value, label }) => ({ value, label }))}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={2}>
                      <Form.Item name={[name, 'active']} valuePropName="checked">
                        <Switch aria-label="Active" size="small" />
                      </Form.Item>
                    </Col>
                    <Col span={2}>
                      <Button
                        type="text"
                        icon={<DeleteOutlined />}
                        aria-label="Remove row"
                        onClick={() => remove(name)}
                      />
                    </Col>
                  </Row>
                ))}
                <Space>
                  <Button
                    type="dashed"
                    icon={<PlusOutlined />}
                    disabled={fields.length >= 40}
                    onClick={() =>
                      add({
                        weekday: account.week_start_day,
                        time: dayjs('2000-01-01T12:00'),
                        format: 'reel',
                        default_role: null,
                        active: true,
                      })
                    }
                  >
                    Add row
                  </Button>
                  <Typography.Text type="secondary">{fields.length} / 40 rows</Typography.Text>
                </Space>
              </>
            )}
          </Form.List>
        </Form>
      )}
    </Drawer>
  );
};

export default TemplateDrawer;
