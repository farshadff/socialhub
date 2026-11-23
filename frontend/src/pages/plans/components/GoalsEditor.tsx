import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Col, Form, InputNumber, Row, Select, Typography } from 'antd';
import type { FormInstance } from 'antd';
import React from 'react';
import type { Metric } from '@/services/socialhub/plans';
import {
  allowedGoalFormats,
  allowedScopes,
  FORMATS,
  type GoalRow,
  METRICS,
  metricLabel,
  metricsWithoutGoal,
  SCOPES,
} from '../shared';

const FORMAT_OPTIONS = [{ value: 'all', label: 'All' }, ...FORMATS];

/** Goal rows with dependent selects (E01-S01 rule 8) and per-row API errors. */
const GoalsEditor: React.FC<{ form: FormInstance; disabled: boolean }> = ({
  form,
  disabled,
}) => {
  const goals: Partial<GoalRow>[] = Form.useWatch('goals', form) ?? [];
  const successMetrics: Metric[] = Form.useWatch('success_metrics', form) ?? [];
  const missing = metricsWithoutGoal(successMetrics, goals);

  /** Keep scope and format valid when the metric changes. */
  const onMetricChange = (index: number, metric: Metric) => {
    const row: Partial<GoalRow> = form.getFieldValue(['goals', index]) ?? {};
    const scopes = allowedScopes(metric);
    const formats = allowedGoalFormats(metric);
    form.setFieldValue(['goals', index], {
      ...row,
      metric,
      scope: row.scope && scopes.includes(row.scope) ? row.scope : scopes[0],
      format: row.format && formats.includes(row.format) ? row.format : 'all',
    });
  };

  return (
    <Form.List name="goals">
      {(fields, { add, remove }, { errors }) => (
        <>
          {fields.length > 0 && (
            <Row gutter={8} aria-hidden>
              <Col span={7}><Typography.Text type="secondary">Metric</Typography.Text></Col>
              <Col span={5}><Typography.Text type="secondary">Scope</Typography.Text></Col>
              <Col span={5}><Typography.Text type="secondary">Format</Typography.Text></Col>
              <Col span={5}><Typography.Text type="secondary">Target</Typography.Text></Col>
            </Row>
          )}
          {fields.map(({ key, name }) => {
            const metric = goals[name]?.metric;
            return (
              <Row gutter={8} key={key} align="top">
                <Col span={7}>
                  <Form.Item
                    name={[name, 'metric']}
                    rules={[{ required: true, message: 'Pick a metric.' }]}
                  >
                    <Select
                      aria-label="Metric"
                      options={METRICS.map(({ value, label }) => ({ value, label }))}
                      onChange={(value: Metric) => onMetricChange(name, value)}
                    />
                  </Form.Item>
                </Col>
                <Col span={5}>
                  <Form.Item name={[name, 'scope']} rules={[{ required: true }]}>
                    <Select
                      aria-label="Scope"
                      options={SCOPES.filter(({ value }) =>
                        allowedScopes(metric).includes(value),
                      )}
                    />
                  </Form.Item>
                </Col>
                <Col span={5}>
                  <Form.Item name={[name, 'format']}>
                    <Select
                      aria-label="Format"
                      options={FORMAT_OPTIONS.filter(({ value }) =>
                        allowedGoalFormats(metric).includes(value as never),
                      )}
                    />
                  </Form.Item>
                </Col>
                <Col span={5}>
                  <Form.Item
                    name={[name, 'target_value']}
                    rules={[{ required: true, message: 'Enter a target.' }]}
                  >
                    <InputNumber<number>
                      aria-label="Target"
                      min={1}
                      max={100_000_000}
                      precision={0}
                      style={{ width: '100%' }}
                      formatter={(value) =>
                        value === undefined ? '' : `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
                      }
                      parser={(value) => Number((value ?? '').replace(/,/g, ''))}
                    />
                  </Form.Item>
                </Col>
                <Col span={2}>
                  {!disabled && (
                    <Button
                      type="text"
                      icon={<DeleteOutlined />}
                      aria-label="Remove goal"
                      onClick={() => remove(name)}
                    />
                  )}
                </Col>
              </Row>
            );
          })}
          <Form.ErrorList errors={errors} />
          {!disabled && (
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              disabled={fields.length >= 20}
              onClick={() => add({ scope: 'week_total', format: 'all' })}
            >
              Add goal
            </Button>
          )}
          {missing.map((item) => (
            <Typography.Paragraph key={item} type="warning" style={{ marginTop: 8, marginBottom: 0 }}>
              No goal for {metricLabel(item).toLowerCase()} yet
            </Typography.Paragraph>
          ))}
        </>
      )}
    </Form.List>
  );
};

export default GoalsEditor;
