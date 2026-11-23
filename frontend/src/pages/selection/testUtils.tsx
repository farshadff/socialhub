import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { Account } from '@/services/socialhub/accounts';
import { ApiError, type ApiErrorBody } from '@/services/socialhub/http';

export const ACCOUNT: Account = {
  id: 3,
  handle: 'brewlab',
  display_name: 'Brew Lab',
  timezone: 'UTC',
  content_language: 'en',
  week_start_day: 5,
  status: 'active',
  publishing_enabled: false,
  autopilot: { selection: false, brief: false, script: false },
  connection_status: 'connected',
};

/** The value `useModel(name)` returns in tests. */
export function modelFor(name: string, account: Account | null = ACCOUNT) {
  if (name === 'account') {
    return {
      accounts: account ? [account] : [],
      currentAccount: account,
      currentAccountId: account?.id ?? null,
      loading: false,
      error: null,
      setCurrentAccount: () => undefined,
      refreshAccounts: () => undefined,
    };
  }
  return { initialState: { currentUser: { access: 'admin' } } };
}

export function withQueryClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
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
