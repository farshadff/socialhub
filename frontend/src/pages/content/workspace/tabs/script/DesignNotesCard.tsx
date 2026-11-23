import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { ProCard } from '@ant-design/pro-components';
import { Button, Col, Form, Row, Space, theme } from 'antd';
import React from 'react';
import { type DesignNotes, SCRIPT_LIMITS } from '@/services/socialhub/scripts';
import {
  ContentInput,
  ContentTextArea,
  Field,
  type FieldState,
  LockTooltip,
  useContentLang,
} from './fields';
import { fieldDomId } from './scriptModel';
import type { NoteField } from './useScriptEditor';

export type DesignNotesCardProps = {
  notes: DesignNotes;
  state: FieldState;
  onChange: (field: NoteField, value: string) => void;
  onListChange: (list: 'do' | 'dont', items: string[]) => void;
};

const NOTE_FIELDS: { field: NoteField; label: string; required?: boolean }[] = [
  { field: 'mood', label: 'Mood', required: true },
  { field: 'color_usage', label: 'Colour use' },
  { field: 'typography', label: 'Typography' },
  { field: 'imagery_style', label: 'Imagery style' },
  { field: 'layout', label: 'Layout', required: true },
];

const LISTS: { list: 'do' | 'dont'; label: string; noun: string }[] = [
  { list: 'do', label: 'Do', noun: 'do' },
  { list: 'dont', label: "Don't", noun: "don't" },
];

/** Design notes: five text fields and the "Do" and "Don't" lists (E05-S02 Design notes). */
const DesignNotesCard: React.FC<DesignNotesCardProps> = ({
  notes,
  state,
  onChange,
  onListChange,
}) => {
  const { token } = theme.useToken();
  const lang = useContentLang();
  const L = SCRIPT_LIMITS;
  return (
    <ProCard
      title="Design notes"
      headerBordered
      collapsible
      defaultCollapsed={false}
      id={fieldDomId('design_notes')}
    >
      <Form layout="vertical" component="div">
        <Row gutter={[token.marginLG, 0]}>
          {NOTE_FIELDS.map(({ field, label, required }) => (
            <Col xs={24} lg={12} key={field}>
              <Field path={`design_notes.${field}`} label={label} state={state} required={required}>
                <ContentTextArea
                  path={`design_notes.${field}`}
                  lang={lang}
                  max={L.design_note.max}
                  autoSize={{ minRows: 2, maxRows: 6 }}
                  value={notes[field]}
                  disabled={state.disabled}
                  onChange={(e) => onChange(field, e.target.value)}
                />
              </Field>
            </Col>
          ))}
          {LISTS.map(({ list, label, noun }) => {
            const items = notes[list];
            const full = items.length >= L.design_list_items;
            return (
              <Col xs={24} lg={12} key={list}>
                <Form.Item
                  label={label}
                  validateStatus={state.status(`design_notes.${list}`)}
                  help={state.error(`design_notes.${list}`)}
                  style={{ marginBottom: token.marginSM }}
                >
                  <Space orientation="vertical" size={token.marginXS} style={{ width: '100%' }}>
                    {items.map((value, i) => {
                      const path = `design_notes.${list}.${i}`;
                      return (
                        <Form.Item
                          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity beyond position
                          key={i}
                          noStyle={!state.error(path)}
                          validateStatus={state.status(path)}
                          help={state.error(path)}
                        >
                          <Space.Compact style={{ width: '100%' }}>
                            <LockTooltip reason={state.disabled ? state.lockReason : undefined}>
                              <ContentInput
                                path={path}
                                lang={lang}
                                max={L.design_list_item_chars}
                                aria-label={`${label} item ${i + 1}`}
                                status={state.status(path)}
                                value={value}
                                disabled={state.disabled}
                                onChange={(e) =>
                                  onListChange(
                                    list,
                                    items.map((item, j) => (j === i ? e.target.value : item)),
                                  )
                                }
                              />
                            </LockTooltip>
                            <Button
                              icon={<DeleteOutlined />}
                              aria-label={`Remove ${noun} item ${i + 1}`}
                              disabled={state.disabled}
                              onClick={() =>
                                onListChange(
                                  list,
                                  items.filter((_, j) => j !== i),
                                )
                              }
                            />
                          </Space.Compact>
                        </Form.Item>
                      );
                    })}
                    <Button
                      type="dashed"
                      icon={<PlusOutlined />}
                      disabled={state.disabled || full}
                      onClick={() => onListChange(list, [...items, ''])}
                    >
                      {`Add ${noun} item`}
                    </Button>
                  </Space>
                </Form.Item>
              </Col>
            );
          })}
        </Row>
      </Form>
    </ProCard>
  );
};

export default DesignNotesCard;
