import { Alert, Space, Typography } from 'antd';
import React from 'react';
import ContentText from '@/components/ContentText';
import type { Finding, FindingSeverity } from '@/services/socialhub/quality';
import FindingLocation from './FindingLocation';
import SeverityTag from './SeverityTag';

const ORDER: FindingSeverity[] = ['blocker', 'major', 'minor', 'info'];

const FindingList: React.FC<{
  findings: Finding[];
  itemId: number;
  revised?: boolean;
}> = ({ findings, itemId, revised }) => {
  if (!findings.length) {
    return <Typography.Text type="secondary">No findings.</Typography.Text>;
  }
  const ordered = [...findings].sort(
    (a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity),
  );
  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      {ordered.map((finding) => (
        <Alert
          key={`${finding.code}:${JSON.stringify(finding.location)}:${finding.message}`}
          type={finding.severity === 'blocker' || finding.severity === 'major' ? 'warning' : 'info'}
          showIcon={false}
          message={
            <Space wrap size={[6, 4]}>
              <SeverityTag severity={finding.severity} />
              <Typography.Text code>{finding.code}</Typography.Text>
              {revised && finding.auto_fixable ? <Typography.Text type="success">Fixed automatically</Typography.Text> : null}
              {!finding.override_allowed ? <Typography.Text type="danger">Cannot be overridden</Typography.Text> : null}
              <FindingLocation itemId={itemId} location={finding.location} />
            </Space>
          }
          description={
            <Space direction="vertical" size={4}>
              <ContentText>{finding.message}</ContentText>
              {finding.suggestion ? <Typography.Text type="secondary">{finding.suggestion}</Typography.Text> : null}
            </Space>
          }
        />
      ))}
    </Space>
  );
};

export default FindingList;
