import { Link, useModel } from '@umijs/max';
import { Tooltip } from 'antd';
import React from 'react';
import StatusTag, { lookupStatus } from '@/components/StatusTag';

/** Connection states worth a top-bar warning; `connected` (including `manual`) shows nothing. */
const UNHEALTHY = new Set(['expiring', 'needs_attention', 'disconnected']);

/**
 * E00-S02 rule 23, left of the publishing indicator: the current account's Instagram connection
 * when it is not healthy, linking to the account's Connection tab.
 */
export const ConnectionIndicator: React.FC = () => {
  const { currentAccount } = useModel('account');
  if (!currentAccount || !UNHEALTHY.has(currentAccount.connection_status)) {
    return null;
  }
  const status = currentAccount.connection_status;
  const label = lookupStatus('connection', status)?.label ?? status;
  return (
    <Tooltip title={`Instagram connection: ${label}`}>
      <Link
        to={`/settings/accounts/${currentAccount.id}?tab=connection`}
        aria-label={`Instagram connection: ${label}. Open connection settings`}
      >
        <StatusTag kind="connection" status={status} />
      </Link>
    </Tooltip>
  );
};

/**
 * E00-S02 rule 23: "Publishing on" (green) or "Publishing off" (red) for the current account,
 * linking to its Automation tab. Hidden when there is no account.
 */
export const PublishingIndicator: React.FC = () => {
  const { currentAccount } = useModel('account');
  if (!currentAccount) return null;
  const status = currentAccount.publishing_enabled ? 'on' : 'off';
  const label = lookupStatus('publishing', status)?.label;
  return (
    <Link
      to={`/settings/accounts/${currentAccount.id}?tab=automation`}
      aria-label={`${label}. Open automation settings`}
    >
      <StatusTag kind="publishing" status={status} />
    </Link>
  );
};
