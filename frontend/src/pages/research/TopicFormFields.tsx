import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
  ProFormCheckbox,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import { Button, Form, Input, Space } from 'antd';
import React from 'react';
import { FORMATS, type TopicContent } from '@/services/socialhub/research';
import { FORMAT_LABEL } from './constants';

export type TopicFormValues = {
  title: string;
  summary?: string;
  why_now?: string;
  hooks?: string[];
  suggested_formats?: TopicContent['suggested_formats'];
  keywords?: string[];
};

const maxItems = (max: number, noun: string) => ({
  validator: async (_: unknown, value?: unknown[]) => {
    if ((value?.length ?? 0) > max)
      throw new Error(`Use at most ${max} ${noun}.`);
  },
});

/** Trims text and drops empty list entries before sending. */
export function cleanTopicValues(values: TopicFormValues): TopicContent {
  return {
    title: values.title.trim(),
    summary: (values.summary ?? '').trim(),
    why_now: (values.why_now ?? '').trim(),
    hooks: (values.hooks ?? [])
      .map((hook) => (hook ?? '').trim())
      .filter(Boolean),
    suggested_formats: values.suggested_formats ?? [],
    keywords: (values.keywords ?? []).map((k) => k.trim()).filter(Boolean),
  };
}

/** Topic fields shared by the drawer's edit form and "Add topic" (E02-S05 Panel). */
const TopicFormFields: React.FC = () => (
  <>
    <ProFormText
      name="title"
      label="Title"
      fieldProps={{ dir: 'auto' }}
      rules={[
        { required: true, whitespace: true, message: 'Enter a title.' },
        { min: 3, message: 'Use at least 3 characters.' },
        { max: 120, message: 'Use at most 120 characters.' },
      ]}
    />
    <ProFormTextArea
      name="summary"
      label="Summary"
      fieldProps={{ dir: 'auto', rows: 3 }}
      rules={[{ max: 600, message: 'Use at most 600 characters.' }]}
    />
    <ProFormTextArea
      name="why_now"
      label="Why now"
      fieldProps={{ dir: 'auto', rows: 2 }}
      rules={[{ max: 300, message: 'Use at most 300 characters.' }]}
    />
    <Form.Item label="Hooks" required={false}>
      <Form.List name="hooks" rules={[maxItems(5, 'hooks')]}>
        {(fields, { add, remove }, { errors }) => (
          <Space orientation="vertical" style={{ width: '100%' }}>
            {fields.map((field, index) => (
              <Space key={field.key} align="start" style={{ width: '100%' }}>
                <Form.Item
                  name={field.name}
                  noStyle
                  rules={[{ max: 160, message: 'Use at most 160 characters.' }]}
                >
                  <Input
                    dir="auto"
                    aria-label={`Hook ${index + 1}`}
                    style={{ minWidth: 420 }}
                  />
                </Form.Item>
                <Button
                  type="text"
                  icon={<DeleteOutlined />}
                  aria-label={`Remove hook ${index + 1}`}
                  onClick={() => remove(field.name)}
                />
              </Space>
            ))}
            {fields.length < 5 ? (
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                onClick={() => add('')}
              >
                Add hook
              </Button>
            ) : null}
            <Form.ErrorList errors={errors} />
          </Space>
        )}
      </Form.List>
    </Form.Item>
    <ProFormCheckbox.Group
      name="suggested_formats"
      label="Formats"
      options={FORMATS.map((format) => ({
        value: format,
        label: FORMAT_LABEL[format],
      }))}
      rules={[maxItems(3, 'formats')]}
    />
    <ProFormSelect
      name="keywords"
      label="Keywords"
      mode="tags"
      placeholder="Type a keyword and press Enter"
      fieldProps={{ tokenSeparators: [','], open: false, suffixIcon: null }}
      rules={[
        maxItems(8, 'keywords'),
        {
          validator: async (_, value?: string[]) => {
            if ((value ?? []).some((k) => k.length > 40)) {
              throw new Error('Each keyword can have at most 40 characters.');
            }
          },
        },
      ]}
    />
  </>
);

export default TopicFormFields;
