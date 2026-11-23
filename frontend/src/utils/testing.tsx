/**
 * Helpers for component tests of the E00 shared components and the Settings pages. Not imported
 * by application code.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { Account } from '@/services/socialhub/accounts';
import { ApiError, type ApiErrorBody } from '@/services/socialhub/http';
import type { Job } from '@/services/socialhub/jobs';

export const TEST_ACCOUNT: Account = {
  id: 1,
  handle: 'greenhome.ir',
  display_name: 'Green Home',
  timezone: 'Asia/Tehran',
  content_language: 'fa',
  week_start_day: 5,
  status: 'active',
  publishing_enabled: false,
  autopilot: { selection: false, brief: false, script: false },
  posting_rules: {
    min_gap_minutes: 120,
    max_feed_per_day: 2,
    max_stories_per_day: 5,
    max_revisions: 2,
  },
  notes: '',
  connection_status: 'disconnected',
  connection_provider: 'graph_api',
  brand_complete: false,
  created_at: '2026-11-23T08:12:40Z',
  updated_at: '2026-11-23T08:12:40Z',
};

export const testJob = (overrides: Partial<Job> = {}): Job => ({
  id: 'job-1',
  kind: 'system.ai_test',
  status: 'running',
  progress: 0,
  message: '',
  account: null,
  queue: 'default',
  target_type: 'system',
  target_id: 'ai',
  result: null,
  error_code: null,
  error_detail: null,
  created_by: { id: 1, name: 'Sara' },
  request_id: 'req-job',
  created_at: '2026-11-25T10:02:00Z',
  started_at: '2026-11-25T10:02:00Z',
  finished_at: null,
  ...overrides,
});

/** What `useModel(name)` returns in tests, for an admin or an operator. */
export function testModel(
  name: string,
  options: {
    access?: 'admin' | 'operator';
    account?: Account | null;
    refreshAccounts?: () => unknown;
    setCurrentAccount?: (id: number) => void;
  } = {},
) {
  const account =
    options.account === undefined ? TEST_ACCOUNT : options.account;
  if (name === 'account') {
    return {
      accounts: account ? [account] : [],
      currentAccount: account,
      currentAccountId: account?.id ?? null,
      loading: false,
      error: null,
      setCurrentAccount: options.setCurrentAccount ?? (() => undefined),
      refreshAccounts: options.refreshAccounts ?? (() => Promise.resolve()),
    };
  }
  return {
    initialState: {
      currentUser: { id: 1, name: 'Sara', access: options.access ?? 'admin' },
    },
  };
}

export function testQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

export function withQueryClient(
  node: React.ReactNode,
  client = testQueryClient(),
) {
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

export function apiError(
  status: number,
  body: Partial<ApiErrorBody> & { code: string },
) {
  return new ApiError(status, {
    message: body.code,
    request_id: 'req-1',
    fields: [],
    ...body,
  });
}

/** `#` + digits, so test files hold no hex colour literal (src/utils/hexColors.test.ts). */
export const hex = (digits: string) => `#${digits}`;
