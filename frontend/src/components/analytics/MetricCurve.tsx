import { Line } from '@ant-design/plots';
import { Empty, Segmented, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useMemo, useState } from 'react';
import DateTime from '@/components/DateTime';
import type { AnalyticsCheckpoint, MetricSnapshot } from '@/services/socialhub/analytics';
import type { Metric } from '@/services/socialhub/plans';
import MetricCell from './MetricCell';
import { CHECKPOINT_LABEL } from './CheckpointTable';

type Point = { checkpoint: string; age_hours: number; value: number | null; captured_at: string; source: 'provider' | 'manual'; gap?: boolean };
const CHECKPOINT_AGE_HOURS: Record<string, number> = { '1h': 1, '6h': 6, '23h': 23, '24h': 24, '72h': 72, '7d': 168 };

const MetricCurve: React.FC<{ checkpoints: AnalyticsCheckpoint[]; adhoc?: MetricSnapshot[]; metrics: Metric[] }> = ({ checkpoints, adhoc = [], metrics }) => {
  const [metric, setMetric] = useState<Metric>(metrics.includes('reach') ? 'reach' : metrics[0] ?? 'reach');
  const [table, setTable] = useState(false);
  const data = useMemo(() => {
    const captured: Point[] = [
      ...checkpoints.flatMap((point) => {
        const snapshot = point.snapshot;
        return point.status === 'captured' && snapshot ? [{
          checkpoint: CHECKPOINT_LABEL[point.checkpoint] ?? point.checkpoint,
          age_hours: snapshot.age_minutes / 60,
          value: snapshot[metric] as number | null,
          captured_at: snapshot.captured_at,
          source: snapshot.source,
        }] : [];
      }),
      ...adhoc.map((snapshot) => ({ checkpoint: 'Ad hoc', age_hours: snapshot.age_minutes / 60, value: snapshot[metric] as number | null, captured_at: snapshot.captured_at, source: snapshot.source })),
    ].sort((a, b) => a.age_hours - b.age_hours);
    const gaps: Point[] = checkpoints
      .filter((point) => point.status === 'skipped')
      .map((point) => ({
        checkpoint: CHECKPOINT_LABEL[point.checkpoint] ?? point.checkpoint,
        age_hours: CHECKPOINT_AGE_HOURS[point.checkpoint] ?? 0,
        value: null,
        captured_at: '',
        source: 'provider',
        gap: true,
      }));
    return [...captured, ...gaps].sort((a, b) => a.age_hours - b.age_hours);
  }, [checkpoints, adhoc, metric]);
  const chartData = data.filter((point) => Number.isFinite(point.age_hours));
  const captured = data.filter((point) => !point.gap && point.value !== null && Number.isFinite(point.age_hours));
  const columns: ColumnsType<Point> = [
    { title: 'Checkpoint', dataIndex: 'checkpoint' },
    { title: 'Age (hours)', dataIndex: 'age_hours', render: (value) => Number.isFinite(value) ? value.toFixed(1) : '—' },
    { title: metric.replace('_', ' '), dataIndex: 'value', render: (value, row) => <MetricCell metric={metric} value={value} source={row.source} /> },
    { title: 'Captured', dataIndex: 'captured_at', render: (value) => value ? <DateTime value={value} /> : '—' },
  ];
  if (!metrics.length) return <Empty description="No metrics apply to this format." />;
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
        <Segmented value={metric} options={metrics.map((value) => ({ value, label: value.replace('_', ' ') }))} onChange={(value) => setMetric(value as Metric)} />
        <Segmented value={table ? 'table' : 'chart'} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} onChange={(value) => setTable(value === 'table')} />
      </Space>
      {table ? <Table<Point> rowKey={(point) => `${point.checkpoint}-${point.captured_at}`} size="small" pagination={false} dataSource={captured} columns={columns} /> : captured.length < 2 ? <Empty description="The curve appears after two readings." /> : (
        <Line
          data={chartData}
          xField="age_hours"
          yField="value"
          point={{ shapeField: 'circle', sizeField: 4 }}
          connectNulls={false}
          tooltip={{ title: 'checkpoint', items: [{ channel: 'y', name: metric.replace('_', ' ') }] }}
          axis={{ x: { title: 'Age (hours)' }, y: { title: metric.replace('_', ' ') } }}
          height={280}
        />
      )}
      {checkpoints.some((point) => point.status === 'skipped') ? <Typography.Text type="secondary">Skipped checkpoints are omitted from the curve.</Typography.Text> : null}
    </Space>
  );
};

export default MetricCurve;
