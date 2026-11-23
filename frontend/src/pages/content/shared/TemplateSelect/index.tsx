import { Button, Flex, Select, Space, Typography, theme } from 'antd';
import React from 'react';
import { useRenderTemplates } from '@/pages/content/shared/useRenderTemplates';
import type { Format, FrameTemplateKey } from '@/services/socialhub/formats';
import type {
  RenderTemplate,
  TemplateField,
} from '@/services/socialhub/production';

/** Width of the template preview in the options (E06-S02 panel). */
const PREVIEW_WIDTH = 48;

function fieldText(
  label: string,
  field: TemplateField,
  first: boolean,
): string {
  if (field.items) {
    const lines = `${field.items.min} to ${field.items.max} points, each up to ${field.items.max_chars}`;
    return `${label} ${field.required ? '' : 'optional, '}${lines}${first ? ' characters' : ''}.`;
  }
  return `${label} ${field.required ? '' : 'optional, '}up to ${field.max_chars}${first ? ' characters' : ''}.`;
}

/** "Headline up to 60 characters. Body optional, up to 120." */
export function templateLimitsText(template: RenderTemplate): string {
  return [
    fieldText('Headline', template.fields.headline, true),
    fieldText('Body', template.fields.body, false),
  ].join(' ');
}

export type TemplateSelectProps = {
  format: Format;
  layout: '4x5' | '9x16';
  value?: FrameTemplateKey;
  onChange?: (value: FrameTemplateKey) => void;
  disabled?: boolean;
  id?: string;
  /** Hides the limits line under the select (the caller shows its own counters). */
  hideLimits?: boolean;
};

/**
 * Frame template picker (E06-S02): options show the template's preview for the current layout,
 * its name and description; the chosen template's limits are listed under the select.
 */
const TemplateSelect: React.FC<TemplateSelectProps> = ({
  format,
  layout,
  value,
  onChange,
  disabled,
  id,
  hideLimits,
}) => {
  const { token } = theme.useToken();
  const { templates, byKey, loading, error, refetch } =
    useRenderTemplates(format);
  const chosen = value ? byKey.get(value) : undefined;

  if (error && templates.length === 0) {
    return (
      <Space size={token.marginXS}>
        <Typography.Text type="danger">
          Templates could not be loaded
        </Typography.Text>
        <Button size="small" onClick={() => refetch()}>
          Retry
        </Button>
      </Space>
    );
  }

  return (
    <Flex vertical gap={token.marginXXS}>
      <Select<FrameTemplateKey>
        id={id}
        value={value}
        onChange={onChange}
        disabled={disabled}
        loading={loading}
        placeholder={loading ? 'Loading templates…' : 'Choose a template'}
        listHeight={360}
        options={templates
          .filter((template) => template.layouts.includes(layout))
          .map((template) => ({
            value: template.key,
            label: template.name,
            template,
          }))}
        optionRender={(option) => {
          const template = (option.data as { template: RenderTemplate })
            .template;
          const preview = template.preview_urls[layout];
          return (
            <Flex gap={token.marginSM} align="center">
              {preview ? (
                <img
                  src={preview}
                  alt=""
                  width={PREVIEW_WIDTH}
                  style={{
                    flex: 'none',
                    aspectRatio: layout === '4x5' ? '4 / 5' : '9 / 16',
                    objectFit: 'cover',
                    borderRadius: token.borderRadiusSM,
                    border: `${token.lineWidth}px ${token.lineType} ${token.colorBorderSecondary}`,
                  }}
                />
              ) : null}
              <Flex vertical style={{ minWidth: 0 }}>
                <Typography.Text strong>{template.name}</Typography.Text>
                <Typography.Text
                  type="secondary"
                  style={{ whiteSpace: 'normal' }}
                >
                  {template.description}
                </Typography.Text>
              </Flex>
            </Flex>
          );
        }}
      />
      {!hideLimits && chosen ? (
        <Typography.Text type="secondary">
          {templateLimitsText(chosen)}
        </Typography.Text>
      ) : null}
    </Flex>
  );
};

export default TemplateSelect;
