import { Tooltip } from 'antd';
import dayjs from 'dayjs';
import React from 'react';
import StatusTag from '@/components/StatusTag';
import type { RightsStatus } from '@/services/socialhub/assets';

export type RightsTagProps = {
  status: RightsStatus;
  /** The asset's licence note, shown in the tooltip. */
  licenseNote?: string | null;
  /** `rights_expires_at`: a date (YYYY-MM-DD) in the account timezone. */
  expiresAt?: string | null;
};

/** "Expires on 30 Jun 2027". The value is a calendar date, so no timezone conversion applies. */
export function expiryText(expiresAt: string | null | undefined): string {
  if (!expiresAt) return 'No expiry date';
  const date = dayjs(expiresAt);
  return `${date.isBefore(dayjs(), 'day') ? 'Expired on' : 'Expires on'} ${date.format('D MMM YYYY')}`;
}

/**
 * Usage rights of an asset (E06-S01): a `StatusTag` of kind `rights` with the licence note and
 * expiry date in a tooltip.
 */
const RightsTag: React.FC<RightsTagProps> = ({
  status,
  licenseNote,
  expiresAt,
}) => {
  const note = licenseNote?.trim();
  const tooltip = (
    <>
      <div>{note ? `Licence note: ${note}` : 'No licence note'}</div>
      <div>{expiryText(expiresAt)}</div>
    </>
  );
  return (
    <Tooltip title={tooltip}>
      <span data-testid="rights-tag">
        <StatusTag kind="rights" status={status} />
      </span>
    </Tooltip>
  );
};

export default RightsTag;
