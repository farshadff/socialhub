import React from 'react';
import StatusTag from '@/components/StatusTag';
import type { FindingSeverity } from '@/services/socialhub/quality';

const SeverityTag: React.FC<{ severity: FindingSeverity }> = ({ severity }) => (
  <StatusTag kind="severity" status={severity} />
);

export default SeverityTag;
