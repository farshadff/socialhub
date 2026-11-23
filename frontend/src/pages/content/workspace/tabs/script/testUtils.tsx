/** Test helpers for the Script tab: account model, query client, API errors and the tab itself. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ApiError, type ApiErrorBody } from '@/services/socialhub/http';
import type { Job } from '@/services/socialhub/jobs';

export const ACCOUNT = {
  id: 3,
  handle: 'brewlab',
  content_language: 'fa',
  timezone: 'Asia/Tehran',
};

/** What `useModel(name)` returns in these tests. */
export function modelFor(name: string) {
  if (name === 'account') {
    return { currentAccount: ACCOUNT, currentAccountId: 3, loading: false };
  }
  return { initialState: { currentUser: { access: 'admin' } } };
}

export function withQueryClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

export function apiError(status: number, body: Partial<ApiErrorBody> & { code: string }) {
  return new ApiError(status, { message: body.code, request_id: 'req-1', fields: [], ...body });
}

export const noScript = () =>
  apiError(404, { code: 'not_found', details: { reason: 'no_script' } });

export function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    kind: 'script.generate',
    status: 'running',
    progress: 30,
    message: 'Writing the script',
    account: 3,
    queue: 'default',
    target_type: 'content_item',
    target_id: '42',
    result: null,
    error_code: null,
    error_detail: null,
    created_by: null,
    request_id: 'req-job',
    created_at: '2026-12-01T08:15:00Z',
    started_at: '2026-12-01T08:15:01Z',
    finished_at: null,
    ...overrides,
  };
}
