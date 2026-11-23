import { EditOutlined } from '@ant-design/icons';
import { Tooltip, Typography } from 'antd';
import React from 'react';
import type { Metric } from '@/services/socialhub/plans';

const MetricCell: React.FC<{
  metric: Metric;
  value: number | null | undefined;
  unavailable?: Metric[];
  source?: 'provider' | 'manual' | null;
  applicable?: boolean;
}> = ({ metric, value, unavailable = [], source, applicable = true }) => {
  if (!applicable) return <Typography.Text type="secondary">—</Typography.Text>;
  if (unavailable.includes(metric)) {
    return <Tooltip title="Instagram did not return this metric."><Typography.Text type="secondary">N/A</Typography.Text></Tooltip>;
  }
  if (value === null || value === undefined) return <Typography.Text type="secondary">—</Typography.Text>;
  return (
    <Tooltip title={source === 'manual' ? 'Entered by hand' : undefined}>
      <Typography.Text>{new Intl.NumberFormat('en-US').format(value)}{source === 'manual' ? <EditOutlined aria-label="Entered by hand" style={{ marginInlineStart: 4 }} /> : null}</Typography.Text>
    </Tooltip>
  );
};

export default MetricCell;
