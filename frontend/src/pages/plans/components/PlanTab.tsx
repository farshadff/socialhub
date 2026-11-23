import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { FooterToolbar, ProCard } from '@ant-design/pro-components';
import { history } from '@umijs/max';
import {
  Alert,
  Button,
  Checkbox,
  Col,
  Flex,
  Form,
  Input,
  message,
  Modal,
  Row,
  Typography,
} from 'antd';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Account } from '@/services/socialhub/accounts';
import { isApiError } from '@/services/socialhub/http';
import {
  type CarriedFinding,
  type FindingState,
  type Metric,
  type Plan,
  updatePlan,
} from '@/services/socialhub/plans';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { notifyError } from '@/utils/errorText';
import {
  appendText,
  buildPatch,
  findingEffect,
  findingStatesFrom,
  formValuesFrom,
  type GoalRow,
  METRICS,
  type PlanFormValues,
  planFieldText,
  type ReadinessLine,
} from '../shared';
import FindingsCard from './FindingsCard';
import GoalsEditor from './GoalsEditor';
import ReadinessCard from './ReadinessCard';

export type PlanTabProps = {
  plan: Plan;
  account: Account;
  active: boolean;
  onSaved: (plan: Plan) => void;
  onConflict: () => void;
  onGoToSlots: () => void;
  /** Lets the page ask the tab to save first (before activating). */
  registerSave: (save: (() => Promise<boolean>) | null, dirty: boolean) => void;
};

const PlanTab: React.FC<PlanTabProps> = ({
  plan,
  account,
  active,
  onSaved,
  onConflict,
  onGoToSlots,
  registerSave,
}) => {
  const [form] = Form.useForm<PlanFormValues>();
  const [initial, setInitial] = useState(() => formValuesFrom(plan));
  const [initialStates, setInitialStates] = useState(() => findingStatesFrom(plan));
  const [states, setStates] = useState(initialStates);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const closed = plan.status === 'closed';

  const reset = useCallback(
    (next: Plan) => {
      const values = formValuesFrom(next);
      const nextStates = findingStatesFrom(next);
      setInitial(values);
      setInitialStates(nextStates);
      setStates(nextStates);
      form.resetFields();
      form.setFieldsValue(values);
      setDirty(false);
      setFormErrors([]);
    },
    [form],
  );

  // A different version of the plan from the server (reload after a conflict, another tab's
  // action) replaces the form only when there is nothing unsaved.
  useEffect(() => {
    if (!dirty) reset(plan);
  }, [plan.updated_at]);

  const recomputeDirty = useCallback(
    (nextStates = states) => {
      const values = form.getFieldsValue(true) as PlanFormValues;
      setDirty(
        Object.keys(buildPatch(initial, values, initialStates, nextStates)).length > 0,
      );
    },
    [form, initial, initialStates, states],
  );

  const save = useCallback(async (): Promise<boolean> => {
    try {
      await form.validateFields();
    } catch {
      return false;
    }
    const values = form.getFieldsValue(true) as PlanFormValues;
    const patch = buildPatch(initial, values, initialStates, states);
    if (Object.keys(patch).length === 0) return true;
    setSaving(true);
    setFormErrors([]);
    try {
      const saved = await updatePlan(plan.id, patch);
      message.success('Plan saved');
      reset(saved);
      onSaved(saved);
      return true;
    } catch (error) {
      if (isApiError(error) && error.status === 409) {
        message.warning('This plan changed. Reloading.');
        setDirty(false);
        onConflict();
      } else if (isApiError(error) && error.code === 'validation_error') {
        setFormErrors(applyFieldErrors(form, error, (field) => planFieldText(field, account)));
      } else {
        notifyError(error);
      }
      return false;
    } finally {
      setSaving(false);
    }
  }, [form, initial, initialStates, states, plan.id, reset, onSaved, onConflict, account]);

  useEffect(() => {
    registerSave(save, dirty);
    return () => registerSave(null, false);
  }, [registerSave, save, dirty]);

  // Unsaved-changes guard for in-app navigation and for closing or reloading the tab.
  useEffect(() => {
    if (!dirty) return undefined;
    const unblock = history.block((transition: { retry: () => void }) => {
      Modal.confirm({
        title: 'You have unsaved changes. Leave without saving?',
        okText: 'Leave',
        cancelText: 'Stay',
        onOk: () => {
          unblock();
          transition.retry();
        },
      });
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      unblock();
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [dirty]);

  const setFindingState = (finding: CarriedFinding, state: FindingState) => {
    const next = { ...states, [finding.id]: state };
    setStates(next);
    recomputeDirty(next);
  };

  const applyFinding = (finding: CarriedFinding) => {
    const effect = findingEffect(finding);
    if (effect.kind === 'append') {
      form.setFieldValue(
        effect.field,
        appendText(form.getFieldValue(effect.field), effect.text),
      );
    } else if (effect.kind === 'goal') {
      const goals: GoalRow[] = form.getFieldValue('goals') ?? [];
      form.setFieldValue('goals', [
        ...goals,
        { scope: 'week_total', format: 'all', ...effect.goal } as GoalRow,
      ]);
    }
    setFindingState(finding, 'applied');
  };

  const goTo = (target: NonNullable<ReadinessLine['target']>) => {
    if (target === 'slots') {
      onGoToSlots();
    } else if (target === 'goals') {
      document.getElementById('plan-goals')?.scrollIntoView({ behavior: 'smooth' });
    } else {
      form.scrollToField(target, { behavior: 'smooth', block: 'center' });
      form.focusField(target);
    }
  };

  const metricOptions = useMemo(
    () =>
      METRICS.map((metric) => ({
        value: metric.value,
        label: (
          <span>
            {metric.label}
            <Typography.Text type="secondary"> — {metric.help}</Typography.Text>
          </span>
        ),
      })),
    [],
  );

  return (
    <>
      {closed && (
        <Alert type="info" showIcon title="This plan is closed." style={{ marginBottom: 16 }} />
      )}
      {formErrors.length > 0 && (
        <Alert type="error" showIcon title={formErrors.join(' ')} style={{ marginBottom: 16 }} />
      )}
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Form<PlanFormValues>
            form={form}
            layout="vertical"
            initialValues={initial}
            onValuesChange={() => recomputeDirty()}
            requiredMark={false}
          >
            <Flex vertical gap={16}>
              <FindingsCard
                findings={plan.carried_findings}
                states={states}
                disabled={closed}
                onApply={applyFinding}
                onIgnore={(finding) => setFindingState(finding, 'ignored')}
                onUndo={(finding) => setFindingState(finding, 'pending')}
              />
              <ProCard title="Objective and audience" headerBordered>
                <Form.Item name="objective" label="Objective">
                  <Input.TextArea
                    rows={4}
                    maxLength={1000}
                    showCount
                    dir="auto"
                    disabled={closed}
                    placeholder="What this week is for"
                  />
                </Form.Item>
                <Form.Item name="audience_summary" label="Audience summary">
                  <Input.TextArea
                    rows={4}
                    maxLength={2000}
                    showCount
                    dir="auto"
                    disabled={closed}
                    placeholder="Who this week speaks to"
                  />
                </Form.Item>
                <Typography.Text strong>Segments</Typography.Text>
                <Form.List name="audience_segments">
                  {(fields, { add, remove }) => (
                    <>
                      {fields.map(({ key, name }) => (
                        <Row gutter={8} key={key} style={{ marginTop: 8 }}>
                          <Col span={8}>
                            <Form.Item
                              name={[name, 'name']}
                              rules={[{ required: true, message: 'Name the segment.' }]}
                            >
                              <Input
                                aria-label="Segment name"
                                placeholder="Name"
                                maxLength={60}
                                dir="auto"
                                disabled={closed}
                              />
                            </Form.Item>
                          </Col>
                          <Col span={14}>
                            <Form.Item name={[name, 'description']}>
                              <Input
                                aria-label="Segment description"
                                placeholder="Description"
                                maxLength={300}
                                dir="auto"
                                disabled={closed}
                              />
                            </Form.Item>
                          </Col>
                          <Col span={2}>
                            {!closed && (
                              <Button
                                type="text"
                                icon={<DeleteOutlined />}
                                aria-label="Remove segment"
                                onClick={() => remove(name)}
                              />
                            )}
                          </Col>
                        </Row>
                      ))}
                      {!closed && (
                        <Button
                          type="dashed"
                          icon={<PlusOutlined />}
                          disabled={fields.length >= 5}
                          onClick={() => add({ name: '', description: '' })}
                          style={{ marginTop: 8 }}
                        >
                          Add segment
                        </Button>
                      )}
                    </>
                  )}
                </Form.List>
              </ProCard>
              <ProCard title="Success metrics" headerBordered>
                <Form.Item
                  name="success_metrics"
                  extra="Tick between one and four metrics that decide whether the week worked."
                  rules={[
                    {
                      validator: (_, value: Metric[] = []) =>
                        value.length >= 1 && value.length <= 4
                          ? Promise.resolve()
                          : Promise.reject(new Error('Tick between one and four metrics.')),
                    },
                  ]}
                >
                  <Checkbox.Group disabled={closed}>
                    <Flex vertical gap={4}>
                      {metricOptions.map((option) => (
                        <Checkbox key={option.value} value={option.value}>
                          {option.label}
                        </Checkbox>
                      ))}
                    </Flex>
                  </Checkbox.Group>
                </Form.Item>
              </ProCard>
              <ProCard title="Goals" headerBordered id="plan-goals">
                <GoalsEditor form={form} disabled={closed} />
              </ProCard>
              <ProCard title="Notes" headerBordered>
                <Form.Item name="notes" noStyle>
                  <Input.TextArea rows={4} maxLength={5000} dir="auto" aria-label="Notes" />
                </Form.Item>
              </ProCard>
            </Flex>
          </Form>
        </Col>
        <Col xs={24} xl={8}>
          <ReadinessCard readiness={plan.readiness} onGo={goTo} />
        </Col>
      </Row>
      {active && (
        <FooterToolbar>
          {dirty && <Typography.Text type="secondary">Unsaved changes</Typography.Text>}
          <Button
            onClick={() => reset(plan)}
            disabled={!dirty || saving}
          >
            Discard changes
          </Button>
          <Button type="primary" loading={saving} disabled={!dirty} onClick={save}>
            Save
          </Button>
        </FooterToolbar>
      )}
    </>
  );
};

export default PlanTab;
