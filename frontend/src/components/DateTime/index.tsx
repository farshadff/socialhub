import { Tooltip } from 'antd';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import React from 'react';
import { useCurrentAccount } from '@/utils/accountRequest';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);

export type DateTimeFormat = 'datetime' | 'date' | 'time' | 'relative';

const FORMATS: Record<Exclude<DateTimeFormat, 'relative'>, string> = {
  datetime: 'D MMM YYYY, HH:mm',
  date: 'D MMM YYYY',
  time: 'HH:mm',
};

export function formatDateTime(
  value: string,
  tz: string,
  format: DateTimeFormat = 'datetime',
): string {
  const local = dayjs.utc(value).tz(tz);
  return format === 'relative'
    ? local.fromNow()
    : local.format(FORMATS[format]);
}

export type DateTimeProps = {
  value: string | null | undefined;
  format?: DateTimeFormat;
  /** Overrides the current account's timezone. */
  timezone?: string;
  /** Text for a null value; default "—". */
  empty?: React.ReactNode;
};

/** A UTC timestamp shown in the account's timezone, with the UTC value in a tooltip. */
const DateTime: React.FC<DateTimeProps> = ({
  value,
  format,
  timezone: tz,
  empty,
}) => {
  const { account } = useCurrentAccount();
  if (!value) return <span>{empty ?? '—'}</span>;
  const zone = tz ?? account?.timezone ?? 'UTC';
  const utcText = dayjs.utc(value).format(FORMATS.datetime);
  return (
    <Tooltip title={`${utcText} UTC · ${zone}`}>
      <time dateTime={value}>{formatDateTime(value, zone, format)}</time>
    </Tooltip>
  );
};

export default DateTime;
