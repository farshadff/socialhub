import { Descriptions, Space, Typography, theme } from 'antd';
import React from 'react';
import ContentText from '@/components/ContentText';
import useFormats from '@/pages/content/shared/useFormats';
import type { Brief } from '@/services/socialhub/briefs';
import type { Format } from '@/services/socialhub/formats';
import { METRIC_LABEL } from '@/services/socialhub/formats';
import { defaultMetricFor, domainOf } from './briefLogic';

export type BriefViewProps = {
  brief: Brief;
  format: Format;
  /** Shown as a "Change" link next to the role when the format may be edited. */
  onChangeRole?: () => void;
};

const None: React.FC = () => <Typography.Text type="secondary">None</Typography.Text>;

const BulletList: React.FC<{ items: string[] }> = ({ items }) => {
  const { token } = theme.useToken();
  if (items.length === 0) return <None />;
  return (
    <ul style={{ margin: 0, paddingInlineStart: token.paddingMD }}>
      {items.map((entry, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: list text may repeat; order is stable.
        <li key={index}>
          <ContentText>{entry}</ContentText>
        </li>
      ))}
    </ul>
  );
};

/** View mode of the Brief tab (E04-S03): one column of labelled fields. */
const BriefView: React.FC<BriefViewProps> = ({ brief, format, onChangeRole }) => {
  const { token } = theme.useToken();
  const { roleInfo, roleLabel } = useFormats();
  const role = roleInfo(brief.role);
  const isDefaultMetric = defaultMetricFor(role, format) === brief.success_metric;
  const text = (value: string) =>
    value ? <ContentText as="div" preserveLineBreaks>{value}</ContentText> : <None />;

  const items = [
    {
      key: 'role',
      label: 'Role',
      children: (
        <Space orientation="vertical" size={0}>
          <Space size={token.marginXS}>
            <Typography.Text strong>{roleLabel(brief.role)}</Typography.Text>
            {onChangeRole ? (
              <Typography.Link onClick={onChangeRole}>Change</Typography.Link>
            ) : null}
          </Space>
          {role?.purpose ? (
            <Typography.Text type="secondary">{role.purpose}</Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      key: 'success_metric',
      label: 'Success metric',
      children: (
        <span>
          {METRIC_LABEL[brief.success_metric] ?? brief.success_metric}
          {isDefaultMetric ? (
            <Typography.Text type="secondary"> (default for this role)</Typography.Text>
          ) : null}
        </span>
      ),
    },
    { key: 'objective', label: 'Objective', children: text(brief.objective) },
    { key: 'key_message', label: 'Key message', children: text(brief.key_message) },
    { key: 'hook_direction', label: 'Hook direction', children: text(brief.hook_direction) },
    { key: 'audience_note', label: 'Audience', children: text(brief.audience_note) },
    { key: 'cta', label: 'Call to action', children: text(brief.cta) },
    { key: 'format_notes', label: 'Format notes', children: text(brief.format_notes) },
    { key: 'must_include', label: 'Must include', children: <BulletList items={brief.must_include} /> },
    { key: 'must_avoid', label: 'Must avoid', children: <BulletList items={brief.must_avoid} /> },
    {
      key: 'references',
      label: 'References',
      children:
        brief.references.length === 0 ? (
          <None />
        ) : (
          <ol style={{ margin: 0, paddingInlineStart: token.paddingMD }}>
            {brief.references.map((reference, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: references may share a URL.
              <li key={index}>
                <Space size={token.marginXS} wrap>
                  <Typography.Link href={reference.url} target="_blank" rel="noopener noreferrer">
                    <ContentText>{reference.title || reference.url}</ContentText>
                  </Typography.Link>
                  <Typography.Text type="secondary">{domainOf(reference.url)}</Typography.Text>
                </Space>
              </li>
            ))}
          </ol>
        ),
    },
  ];

  if (brief.feedback) {
    items.push({
      key: 'feedback',
      label: brief.origin === 'ai' ? 'Written with feedback' : 'Change note',
      children: text(brief.feedback),
    });
  }

  return <Descriptions column={1} items={items} />;
};

export default BriefView;
