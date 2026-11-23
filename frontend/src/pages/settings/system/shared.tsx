import { useQuery } from '@tanstack/react-query';
import { Descriptions, Typography } from 'antd';
import React from 'react';
import { searchAccounts } from '@/services/socialhub/accounts';

/** Every account (active and archived), for handles and filters on the System page. */
export function useAllAccounts() {
  const query = useQuery({
    queryKey: ['accounts', 'all'],
    queryFn: () => searchAccounts({ page_size: 100 }),
    staleTime: 60_000,
  });
  const accounts = query.data?.results ?? [];
  const handleOf = (id: number | null | undefined): string | null => {
    if (id === null || id === undefined) return null;
    const account = accounts.find((item) => item.id === id);
    return account ? `@${account.handle}` : `Account ${id}`;
  };
  const options = accounts.map((account) => ({
    value: account.id,
    label: `@${account.handle}`,
  }));
  return { accounts, handleOf, options };
}

/** Formatted JSON in a scrollable block; `dir="auto"` so Persian text inside reads correctly. */
export const JsonBlock: React.FC<{ value: unknown; label: string }> = ({
  value,
  label,
}) => (
  <Typography.Paragraph style={{ marginBottom: 0 }}>
    <pre
      dir="auto"
      data-label={label}
      style={{
        maxHeight: 360,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        margin: 0,
      }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  </Typography.Paragraph>
);

export const formatNumber = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : value.toLocaleString('en');

/** `1840` → "1.8 s". */
export const formatSeconds = (ms: number | null | undefined) =>
  ms === null || ms === undefined
    ? '—'
    : `${(ms / 1000).toLocaleString('en', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })} s`;

/** A decimal string such as `"0.041900"` → "$0.0419". */
export const formatCost = (value: string | number | null | undefined) => {
  const n = Number(value);
  return Number.isFinite(n)
    ? `$${n.toLocaleString('en', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`
    : '—';
};

/** "2 min 5 s", "45 s", "1 h 3 min". */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${seconds % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Label/value rows for the System page cards and drawers. */
export type DetailRow = { label: string; children: React.ReactNode };

export const DetailRows: React.FC<{ rows: DetailRow[] }> = ({ rows }) => (
  <Descriptions
    column={1}
    size="small"
    items={rows.map((row) => ({ key: row.label, ...row }))}
  />
);
