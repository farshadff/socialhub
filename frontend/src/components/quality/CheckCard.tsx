import { Card, Collapse, Descriptions, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React from 'react';
import ContentText from '@/components/ContentText';
import type { CheckName, CheckResult, RunOutcome } from '@/services/socialhub/quality';
import FindingList from './FindingList';
import OutcomeTag from './OutcomeTag';

const CHECK_LABEL: Record<CheckName, string> = {
  format: 'Format',
  rights: 'Rights',
  copy: 'Copy',
  facts: 'Facts',
  design: 'Design',
};

const objectRows = (value: unknown) =>
  value && typeof value === 'object'
    ? Object.entries(value as Record<string, unknown>).map(([key, val]) => ({
        key,
        value: typeof val === 'object' ? JSON.stringify(val) : String(val ?? '—'),
      }))
    : [];

const Details: React.FC<{ check: CheckResult }> = ({ check }) => {
  const details = check.details ?? {};
  if (check.check === 'format') {
    const rows = objectRows(details.probe);
    return rows.length ? <Descriptions size="small" column={2} items={rows.map((row) => ({ key: row.key, label: row.key.replaceAll('_', ' '), children: row.value }))} /> : <Typography.Text type="secondary">No measured media details.</Typography.Text>;
  }
  if (check.check === 'copy') {
    const rows = objectRows(details.counters ?? details);
    return rows.length ? <Descriptions size="small" column={2} items={rows.map((row) => ({ key: row.key, label: row.key.replaceAll('_', ' '), children: row.value }))} /> : <Typography.Text type="secondary">No copy counters were returned.</Typography.Text>;
  }
  if (check.check === 'rights') {
    const assets = Array.isArray(details.assets) ? details.assets : Array.isArray(details.inputs) ? details.inputs : [];
    return assets.length ? (
      <Space direction="vertical">
        {assets.map((asset: any, index: number) => (
          <Typography.Text key={asset.id ?? index}>
            {asset.filename ?? asset.name ?? `Asset ${asset.id ?? index + 1}`} · {asset.origin ?? 'Unknown origin'} · {asset.rights_status ?? asset.status ?? 'Rights unknown'}
          </Typography.Text>
        ))}
      </Space>
    ) : <Typography.Text type="secondary">No input asset details.</Typography.Text>;
  }
  if (check.check === 'facts') {
    const claims = Array.isArray(details.claims) ? details.claims : [];
    const columns: ColumnsType<any> = [
      { title: 'Claim', dataIndex: 'text', render: (text: string) => <ContentText>{text}</ContentText> },
      { title: 'Kind', dataIndex: 'kind', width: 100 },
      { title: 'Status', dataIndex: 'status', width: 130, render: (value: string) => <Typography.Text type={value === 'supported' ? 'success' : 'danger'}>{value}</Typography.Text> },
      { title: 'Reference', dataIndex: 'ref', width: 120, render: (value: string | null) => value ?? '—' },
      { title: 'Evidence', dataIndex: 'evidence_quote', render: (text: string) => text || '—' },
    ];
    return claims.length ? <Table rowKey="id" size="small" pagination={false} dataSource={claims} columns={columns} scroll={{ x: 650 }} /> : <Typography.Text type="secondary">No claims were returned.</Typography.Text>;
  }
  if (check.check === 'design') {
    const frames = Array.isArray(details.frames) ? details.frames : [];
    return frames.length ? (
      <Space wrap>
        {frames.map((frame: any, index: number) => (
          <Card key={frame.index ?? index} size="small" cover={frame.url ? <img src={frame.url} alt={`Frame ${frame.index ?? index + 1}`} style={{ width: 120, objectFit: 'cover' }} /> : undefined}>
            Frame {frame.index ?? index + 1}
          </Card>
        ))}
      </Space>
    ) : <Typography.Text type="secondary">No inspected frame details.</Typography.Text>;
  }
  return null;
};

const CheckCard: React.FC<{
  result: CheckResult;
  itemId: number;
  runOutcome: RunOutcome;
}> = ({ result, itemId, runOutcome }) => {
  const title = CHECK_LABEL[result.check] ?? result.check;
  return (
    <Collapse
      items={[
        {
          key: result.check,
          label: (
            <Space wrap>
              <Typography.Text strong>{title}</Typography.Text>
              <OutcomeTag outcome={result.outcome} />
              <Typography.Text type="secondary">Score {result.score}</Typography.Text>
              <Typography.Text type="secondary">{result.checker === 'rule' ? 'Rules' : 'AI + rules'}</Typography.Text>
              <Typography.Text type="secondary">{result.findings.length} findings</Typography.Text>
            </Space>
          ),
          children: (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <FindingList findings={result.findings} itemId={itemId} revised={runOutcome === 'revise'} />
              {result.details ? (
                <Collapse size="small" items={[{ key: 'details', label: 'Details', children: <Details check={result} /> }]} />
              ) : null}
            </Space>
          ),
        },
      ]}
      defaultActiveKey={result.outcome === 'pass' ? [] : [result.check]}
    />
  );
};

export { CHECK_LABEL };
export default CheckCard;
