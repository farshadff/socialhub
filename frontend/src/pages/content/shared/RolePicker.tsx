import { InfoCircleOutlined } from '@ant-design/icons';
import { Radio, Skeleton, Space, Tooltip, Typography, theme } from 'antd';
import React from 'react';
import {
  type Format,
  METRIC_LABEL,
  ROLE_FALLBACK_LABEL,
  ROLES,
  type Role,
  type RoleInfo,
} from '@/services/socialhub/formats';
import useFormats from './useFormats';

export type RolePickerProps = {
  value?: Role | null;
  onChange?: (value: Role | null) => void;
  /** Story items show the story default metric. */
  format?: Format;
  /** Adds "No role yet" for items without a brief. */
  allowClear?: boolean;
  disabled?: boolean;
  id?: string;
};

const NO_ROLE = '__none__';

/**
 * The five roles as a vertical group of selectable cards (E04-S02): label, purpose, the metric
 * that measures it, and the examples in a tooltip. Reads roles from the format registry.
 */
const RolePicker: React.FC<RolePickerProps> = ({
  value,
  onChange,
  format,
  allowClear,
  disabled,
  id,
}) => {
  const { token } = theme.useToken();
  const { data, loading } = useFormats();

  if (loading) return <Skeleton active paragraph={{ rows: 4 }} />;

  const roles: RoleInfo[] =
    data?.roles ??
    ROLES.map((key) => ({
      key,
      label: ROLE_FALLBACK_LABEL[key],
      purpose: '',
      guidance: '',
      examples: [],
      default_metric: 'reach',
      default_metric_story: 'reach',
    }));

  const card = (selected: boolean): React.CSSProperties => ({
    display: 'flex',
    width: '100%',
    marginInlineEnd: 0,
    padding: `${token.paddingXS}px ${token.paddingSM}px`,
    border: `${token.lineWidth}px ${token.lineType} ${
      selected ? token.colorPrimary : token.colorBorderSecondary
    }`,
    borderRadius: token.borderRadius,
    background: selected ? token.colorPrimaryBg : token.colorBgContainer,
  });

  const current = value ?? (allowClear ? NO_ROLE : undefined);

  return (
    <Radio.Group
      id={id}
      value={current}
      disabled={disabled}
      onChange={(event) => {
        const next = event.target.value as string;
        onChange?.(next === NO_ROLE ? null : (next as Role));
      }}
      style={{ width: '100%' }}
    >
      <Space orientation="vertical" size={token.marginXS} style={{ width: '100%' }}>
        {roles.map((role) => {
          const metric = format === 'story' ? role.default_metric_story : role.default_metric;
          return (
            <Radio key={role.key} value={role.key} style={card(current === role.key)}>
              <Space orientation="vertical" size={0}>
                <Space size={token.marginXXS}>
                  <Typography.Text strong>{role.label}</Typography.Text>
                  {role.examples.length > 0 ? (
                    <Tooltip
                      title={
                        <div>
                          <div>Examples</div>
                          <ul style={{ margin: 0, paddingInlineStart: token.paddingMD }}>
                            {role.examples.map((example) => (
                              <li key={example}>{example}</li>
                            ))}
                          </ul>
                        </div>
                      }
                    >
                      <InfoCircleOutlined
                        aria-label={`Examples for ${role.label}`}
                        style={{ color: token.colorTextSecondary }}
                      />
                    </Tooltip>
                  ) : null}
                </Space>
                {role.purpose ? (
                  <Typography.Text type="secondary">{role.purpose}</Typography.Text>
                ) : null}
                <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  Measured by: {METRIC_LABEL[metric] ?? metric}
                </Typography.Text>
              </Space>
            </Radio>
          );
        })}
        {allowClear ? (
          <Radio value={NO_ROLE} style={card(current === NO_ROLE)}>
            <Typography.Text>No role yet</Typography.Text>
          </Radio>
        ) : null}
      </Space>
    </Radio.Group>
  );
};

export default RolePicker;
