import { Tag } from 'antd';
import React from 'react';
import { lookupStatus, sentenceCase } from './statusMap';

export type StatusTagProps = {
  /** A kind from docs/DESIGN-SYSTEM.md section 3, for example `item` or `connection`. */
  kind: string;
  /** The stored enum value, for example `needs_revision`. */
  status: string;
  /** Replaces the mapped label, for example "Retry 2 of 3". */
  label?: React.ReactNode;
};

/**
 * `<StatusTag kind="item" status="in_review" />` (E00-S02 rule 26). A status is always a tag
 * with text; colour alone never carries meaning. An unknown pair renders a grey tag with the raw
 * value in sentence case and warns in development.
 */
const StatusTag: React.FC<StatusTagProps> = ({ kind, status, label }) => {
  const entry = lookupStatus(kind, status);
  if (!entry && process.env.NODE_ENV === 'development') {
    console.warn(`StatusTag: no entry for kind="${kind}" status="${status}"`);
  }
  return (
    <Tag color={entry?.color ?? 'default'}>
      {label ?? entry?.label ?? sentenceCase(status)}
    </Tag>
  );
};

export default StatusTag;
export type { StatusColor, StatusEntry, StatusKind } from './statusMap';
export { lookupStatus, STATUS_MAP, sentenceCase } from './statusMap';
