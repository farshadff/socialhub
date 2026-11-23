import { Button, Divider, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React from 'react';
import DateTime from '@/components/DateTime';
import StatusTag from '@/components/StatusTag';
import type { AnalyticsCheckpoint, MetricSnapshot } from '@/services/socialhub/analytics';
import type { Metric } from '@/services/socialhub/plans';
import MetricCell from './MetricCell';

export const CHECKPOINT_LABEL: Record<string, string> = {
  '1h': '1 h', '6h': '6 h', '23h': '23 h', '24h': '24 h', '72h': '72 h', '7d': '7 d', adhoc: 'Ad hoc',
};

const ageLabel = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours >= 24) return `${Math.floor(hours / 24)} d ${hours % 24} h`;
  return `${hours} h ${remainder} min`;
};

const CheckpointTable: React.FC<{
  checkpoints: AnalyticsCheckpoint[];
  adhoc?: MetricSnapshot[];
  metrics: Metric[];
  onEnter: (checkpoint: string, snapshot?: MetricSnapshot | null) => void;
}> = ({ checkpoints, adhoc = [], metrics, onEnter }) => {
  const checkpointRows = [
    ...checkpoints.map((row) => ({ ...row, key: row.checkpoint, adhoc: false })),
  ];
  const adhocRows = adhoc.map((snapshot) => ({ checkpoint: 'adhoc', target_at: '', is_final: false, status: 'captured' as const, skip_reason: null, snapshot, key: `adhoc-${snapshot.id ?? snapshot.captured_at}`, adhoc: true }));
  const rows = [...checkpointRows, ...adhocRows];
  const columns: ColumnsType<(typeof rows)[number]> = [
    { title: 'Checkpoint', dataIndex: 'checkpoint', render: (_, row) => row.adhoc ? 'Ad hoc' : CHECKPOINT_LABEL[row.checkpoint] ?? row.checkpoint },
    { title: 'Status', dataIndex: 'status', render: (_, row) => <StatusTag kind="checkpoint" status={row.status} /> },
    { title: 'Captured', dataIndex: ['snapshot', 'captured_at'], render: (_, row) => <DateTime value={row.snapshot?.captured_at} /> },
    { title: 'Age', key: 'age', render: (_, row) => row.snapshot ? <Typography.Text type={row.snapshot.on_time === false ? 'warning' : undefined}>{ageLabel(row.snapshot.age_minutes)}{row.snapshot.on_time === false ? ' · late' : ''}</Typography.Text> : '—' },
    ...metrics.map((metric) => ({
      title: metric.replace('_', ' '),
      key: metric,
      render: (_: unknown, row: (typeof rows)[number]) => <MetricCell metric={metric} value={row.snapshot?.[metric] as number | null | undefined} unavailable={row.snapshot?.unavailable} source={row.snapshot?.source} />,
    })),
    { title: 'Source', key: 'source', render: (_, row) => row.snapshot?.source === 'manual' ? 'Entered by hand' : row.snapshot?.source === 'provider' ? 'Instagram' : '—' },
    { title: '', key: 'action', render: (_, row) => (['skipped', 'due', 'overdue'] as string[]).includes(row.status) ? <Button type="link" size="small" onClick={() => onEnter(row.checkpoint, row.snapshot)}>Enter metrics</Button> : null },
  ];
  return (
    <>
      <Table rowKey="key" size="small" pagination={false} dataSource={checkpointRows} columns={columns} scroll={{ x: 900 }} />
      {adhocRows.length ? <><Divider>Ad hoc readings</Divider><Table rowKey="key" size="small" pagination={false} dataSource={adhocRows} columns={columns} scroll={{ x: 900 }} /></> : null}
    </>
  );
};

export default CheckpointTable;
