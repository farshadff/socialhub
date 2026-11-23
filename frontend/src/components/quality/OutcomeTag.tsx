import { Tag } from 'antd';
import React from 'react';
import StatusTag from '@/components/StatusTag';
import type { CheckOutcome } from '@/services/socialhub/quality';

export type OutcomeTagProps = { outcome: CheckOutcome | 'running' | 'failed' | null };

const OutcomeTag: React.FC<OutcomeTagProps> = ({ outcome }) => {
  if (outcome === 'running') return <Tag color="processing">Running</Tag>;
  if (outcome === 'failed') return <Tag color="error">Run failed</Tag>;
  return outcome ? <StatusTag kind="qc" status={outcome} /> : <Tag>Not run</Tag>;
};

export default OutcomeTag;
