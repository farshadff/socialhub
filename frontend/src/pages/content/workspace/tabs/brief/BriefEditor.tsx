import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Col,
  Drawer,
  Form,
  Input,
  Modal,
  message,
  Row,
  Select,
  Space,
  Typography,
  theme,
} from 'antd';
import React, { useEffect, useMemo, useState } from 'react';
import { confirmDiscard, useLeaveGuard } from '@/pages/content/shared/leaveGuard';
import {
  BRIEF_LIMITS,
  type BriefResource,
  getBrief,
  saveBrief,
  type ValidationIssue,
} from '@/services/socialhub/briefs';
import type { ContentItemDetail } from '@/services/socialhub/content';
import { allowedMetrics, METRIC_LABEL, type Metric } from '@/services/socialhub/formats';
import { isApiError } from '@/services/socialhub/http';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { notifyError } from '@/utils/errorText';
import { type BriefFormValues, isDirty, issueFieldName, toPayload } from './briefLogic';
import BriefView from './BriefView';

export type BriefEditorProps = {
  item: ContentItemDetail;
  initial: BriefFormValues;
  /** The latest version number when editing started; 0 when writing by hand. */
  baseVersion: number;
  planMetrics?: Metric[];
  /** Server issues of the version being edited, shown under their fields. */
  issues?: ValidationIssue[];
  /** A field path to focus when the editor opens (from the problems alert). */
  focusPath?: string | null;
  onSaved: (resource: BriefResource) => void;
  /** Leaves edit mode; `reloadLatest` asks the tab to refetch the brief. */
  onExit: (reloadLatest?: boolean) => void;
};

const LEAVE_TEXT = 'You have unsaved changes. Leave without saving?';

type Conflict = { latest: number; author: string };

type TextFieldName =
  | 'objective'
  | 'key_message'
  | 'hook_direction'
  | 'audience_note'
  | 'cta'
  | 'format_notes';

const TEXT_FIELDS: {
  name: TextFieldName;
  label: string;
  rows: number;
}[] = [
  { name: 'objective', label: 'Objective', rows: 3 },
  { name: 'key_message', label: 'Key message', rows: 2 },
  { name: 'hook_direction', label: 'Hook direction', rows: 2 },
  { name: 'audience_note', label: 'Audience', rows: 2 },
  { name: 'cta', label: 'Call to action', rows: 1 },
  { name: 'format_notes', label: 'Format notes', rows: 4 },
];

/** Edit mode of the Brief tab (E04-S03): saving creates a new version for approval. */
const BriefEditor: React.FC<BriefEditorProps> = ({
  item,
  initial,
  baseVersion: startVersion,
  planMetrics,
  issues,
  focusPath,
  onSaved,
  onExit,
}) => {
  const { token } = theme.useToken();
  const [form] = Form.useForm<BriefFormValues>();
  const [baseVersion, setBaseVersion] = useState(startVersion);
  const [saving, setSaving] = useState(false);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [latest, setLatest] = useState<BriefResource | null>(null);
  const watched = Form.useWatch([], form) as BriefFormValues | undefined;
  const dirty = watched ? isDirty(initial, { ...initial, ...watched }) : false;
  useLeaveGuard(dirty, LEAVE_TEXT);

  const metricOptions = useMemo(
    () =>
      allowedMetrics(item.format, item.media_kind).map((metric) => ({
        value: metric,
        label: (
          <span>
            {METRIC_LABEL[metric]}
            {planMetrics?.includes(metric) ? (
              <Typography.Text type="secondary"> · this week's metric</Typography.Text>
            ) : null}
          </span>
        ),
      })),
    [item.format, item.media_kind, planMetrics],
  );

  // Server issues under their fields, and focus on the field the operator chose to fix.
  useEffect(() => {
    if (issues && issues.length > 0) {
      form.setFields(
        issues.map((issue) => ({
          name: issueFieldName(issue.path) as never,
          errors: [issue.message],
        })),
      );
    }
    if (focusPath) {
      const name = issueFieldName(focusPath);
      window.setTimeout(() => {
        form.scrollToField(name, { block: 'center', focus: true });
      }, 0);
    }
  }, [form, issues, focusPath]);

  const cancel = async () => {
    if (dirty && !(await confirmDiscard(LEAVE_TEXT))) return;
    onExit();
  };

  const save = async () => {
    const values = { ...initial, ...form.getFieldsValue(true) } as BriefFormValues;
    setSaving(true);
    setUnmatched([]);
    try {
      const resource = await saveBrief(item.id, { base_version: baseVersion, ...toPayload(values) });
      message.success(`Saved as version ${resource.latest_version}.`);
      onSaved(resource);
    } catch (error) {
      if (isApiError(error) && error.code === 'version_conflict') {
        const author =
          error.details.latest_origin === 'ai'
            ? 'AI'
            : ((error.details.latest_created_by as { name?: string } | undefined)?.name ??
              'someone else');
        setConflict({ latest: Number(error.details.latest_version), author });
      } else if (isApiError(error) && error.code === 'validation_error') {
        setUnmatched(applyFieldErrors(form, error));
      } else {
        notifyError(error);
      }
    } finally {
      setSaving(false);
    }
  };

  const keepEditing = async () => {
    if (!conflict) return;
    setBaseVersion(conflict.latest);
    setConflict(null);
    try {
      setLatest(await getBrief(item.id));
    } catch (error) {
      notifyError(error);
    }
  };

  const loadLatest = async () => {
    if (!(await confirmDiscard('Discard your changes and load the latest version?', 'Discard and load'))) {
      return;
    }
    setConflict(null);
    onExit(true);
  };

  const counter = (max: number) => ({ show: true, max });

  return (
    <Form<BriefFormValues>
      form={form}
      layout="vertical"
      initialValues={initial}
      onFinish={save}
      requiredMark={false}
    >
      {unmatched.length > 0 ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: token.margin }}
          title={unmatched.join(' ')}
        />
      ) : null}
      {TEXT_FIELDS.map((field) => (
        <Form.Item key={field.name} name={field.name} label={field.label}>
          <Input.TextArea
            dir="auto"
            autoSize={{ minRows: field.rows, maxRows: field.rows + 6 }}
            count={counter(BRIEF_LIMITS[field.name].max)}
          />
        </Form.Item>
      ))}

      {(['must_include', 'must_avoid'] as const).map((listName) => (
        <Form.Item key={listName} label={listName === 'must_include' ? 'Must include' : 'Must avoid'}>
          <Form.List name={listName}>
            {(rows, { add, remove }) => (
              <Space orientation="vertical" size={token.marginXS} style={{ width: '100%' }}>
                {rows.map((row, index) => (
                  <Space.Compact key={row.key} style={{ width: '100%' }}>
                    <Form.Item name={row.name} noStyle>
                      <Input
                        dir="auto"
                        count={counter(BRIEF_LIMITS.list_item_chars)}
                        aria-label={`${listName === 'must_include' ? 'Must include' : 'Must avoid'} ${index + 1}`}
                      />
                    </Form.Item>
                    <Button
                      icon={<DeleteOutlined />}
                      aria-label={`Remove item ${index + 1}`}
                      onClick={() => remove(row.name)}
                    />
                  </Space.Compact>
                ))}
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  disabled={rows.length >= BRIEF_LIMITS.list_items}
                  onClick={() => add('')}
                >
                  Add item
                </Button>
              </Space>
            )}
          </Form.List>
        </Form.Item>
      ))}

      <Form.Item label="References">
        <Form.List name="references">
          {(rows, { add, remove }) => (
            <Space orientation="vertical" size={token.marginXS} style={{ width: '100%' }}>
              {rows.map((row, index) => (
                <Row key={row.key} gutter={token.marginXS} align="top" wrap={false}>
                  <Col flex="1">
                    <Form.Item name={[row.name, 'title']} style={{ marginBottom: 0 }}>
                      <Input
                        dir="auto"
                        placeholder="Title"
                        aria-label={`Reference ${index + 1} title`}
                        count={counter(BRIEF_LIMITS.reference_title)}
                      />
                    </Form.Item>
                  </Col>
                  <Col flex="1">
                    <Form.Item name={[row.name, 'url']} style={{ marginBottom: 0 }}>
                      <Input
                        type="url"
                        placeholder="https://"
                        aria-label={`Reference ${index + 1} URL`}
                      />
                    </Form.Item>
                  </Col>
                  <Col>
                    <Button
                      icon={<DeleteOutlined />}
                      aria-label={`Remove reference ${index + 1}`}
                      onClick={() => remove(row.name)}
                    />
                  </Col>
                </Row>
              ))}
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                disabled={rows.length >= BRIEF_LIMITS.references}
                onClick={() => add({ title: '', url: '' })}
              >
                Add reference
              </Button>
            </Space>
          )}
        </Form.List>
      </Form.Item>

      <Form.Item name="success_metric" label="Success metric">
        <Select options={metricOptions} style={{ maxWidth: 320 }} />
      </Form.Item>

      <Form.Item name="note" label="What changed? (optional)">
        <Input.TextArea dir="auto" autoSize={{ minRows: 1, maxRows: 4 }} count={counter(BRIEF_LIMITS.feedback)} />
      </Form.Item>

      <Space>
        <Button type="primary" htmlType="submit" loading={saving} disabled={!dirty}>
          Save as new version
        </Button>
        <Button onClick={cancel}>Cancel</Button>
      </Space>

      <Modal
        open={conflict !== null}
        title={
          conflict
            ? `Version ${conflict.latest} was written by ${conflict.author} while you were editing.`
            : ''
        }
        closable={false}
        maskClosable={false}
        footer={[
          <Button key="load" danger onClick={loadLatest}>
            Load latest
          </Button>,
          <Button key="keep" type="primary" onClick={keepEditing}>
            Keep editing
          </Button>,
        ]}
      >
        <Typography.Paragraph>
          Load the latest version to start again from it, or keep editing and compare it side by
          side before saving.
        </Typography.Paragraph>
      </Modal>

      <Drawer
        open={latest !== null}
        onClose={() => setLatest(null)}
        title={latest?.brief ? `Latest version: v${latest.brief.version}` : 'Latest version'}
        size="large"
        mask={false}
      >
        {latest?.brief ? <BriefView brief={latest.brief} format={item.format} /> : null}
      </Drawer>
    </Form>
  );
};

export default BriefEditor;
