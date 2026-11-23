import { QueryClientProvider } from '@tanstack/react-query';
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from 'vitest-browser-react';
import { getJob, listJobs } from '@/services/socialhub/jobs';
import { apiError, testJob, testQueryClient } from '@/utils/testing';
import { backoffInterval, useActiveJob, useJob } from './useJob';

vi.mock('@/services/socialhub/jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/jobs')>()),
  getJob: vi.fn(),
  listJobs: vi.fn(),
}));

let counter = 0;
const nextId = () => {
  counter += 1;
  return `job-hook-${counter}`;
};

function setup(client = testQueryClient()) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe('backoffInterval', () => {
  it('doubles the interval per failure up to 10 seconds', () => {
    expect(backoffInterval(2000, 0)).toBe(2000);
    expect(backoffInterval(2000, 1)).toBe(4000);
    expect(backoffInterval(2000, 2)).toBe(8000);
    expect(backoffInterval(2000, 3)).toBe(10_000);
    expect(backoffInterval(2000, 9)).toBe(10_000);
  });
});

describe('useJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'Date',
      ],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls every 2 s while active, stops when the job ends, and calls onDone once', async () => {
    const id = nextId();
    vi.mocked(getJob)
      .mockResolvedValueOnce(testJob({ id, status: 'queued' }))
      .mockResolvedValueOnce(
        testJob({ id, progress: 60, message: 'Rendering' }),
      )
      .mockResolvedValue(testJob({ id, status: 'succeeded', progress: 100 }));
    const onDone = vi.fn();
    const onFailed = vi.fn();
    const { wrapper } = setup();
    const { result, rerender } = await renderHook(
      () => useJob(id, { onDone, onFailed }),
      { wrapper },
    );

    await vi.waitFor(() => expect(result.current.job?.status).toBe('queued'));
    expect(result.current.isActive).toBe(true);

    await tick(2000);
    await vi.waitFor(() => expect(result.current.job?.progress).toBe(60));
    expect(onDone).not.toHaveBeenCalled();

    await tick(2000);
    await vi.waitFor(() =>
      expect(result.current.job?.status).toBe('succeeded'),
    );
    expect(result.current.isActive).toBe(false);
    expect(result.current.isTerminal).toBe(true);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onFailed).not.toHaveBeenCalled();

    const calls = vi.mocked(getJob).mock.calls.length;
    await tick(20_000);
    await rerender();
    expect(vi.mocked(getJob).mock.calls.length).toBe(calls);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('calls onFailed once for a failed job', async () => {
    const id = nextId();
    vi.mocked(getJob)
      .mockResolvedValueOnce(testJob({ id, status: 'running', progress: 20 }))
      .mockResolvedValue(
        testJob({ id, status: 'failed', error_code: 'timeout' }),
      );
    const onDone = vi.fn();
    const onFailed = vi.fn();
    const { wrapper } = setup();
    const { result } = await renderHook(
      () => useJob(id, { onDone, onFailed }),
      { wrapper },
    );
    await vi.waitFor(() => expect(result.current.job?.progress).toBe(20));
    await tick(2000);
    await vi.waitFor(() => expect(onFailed).toHaveBeenCalledTimes(1));
    expect(onFailed.mock.calls[0][0]).toMatchObject({ error_code: 'timeout' });
    await tick(10_000);
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('does not call the callbacks for a job that had already ended before it mounted', async () => {
    const id = nextId();
    const { client, wrapper } = setup();
    client.setQueryData(['job', id], testJob({ id, status: 'succeeded' }));
    vi.mocked(getJob).mockResolvedValue(testJob({ id, status: 'succeeded' }));
    const onDone = vi.fn();
    const { result } = await renderHook(() => useJob(id, { onDone }), {
      wrapper,
    });
    expect(result.current.isTerminal).toBe(true);
    await tick(5000);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('stops on 404 and reports notFound', async () => {
    const id = nextId();
    vi.mocked(getJob).mockRejectedValue(apiError(404, { code: 'not_found' }));
    const { wrapper } = setup();
    const { result } = await renderHook(() => useJob(id), { wrapper });
    await vi.waitFor(() => expect(result.current.notFound).toBe(true));
    expect(result.current.isActive).toBe(false);
    const calls = vi.mocked(getJob).mock.calls.length;
    await tick(30_000);
    expect(vi.mocked(getJob).mock.calls.length).toBe(calls);
  });

  it('keeps polling with backoff on errors and flags a connection problem after five failures', async () => {
    const id = nextId();
    vi.mocked(getJob).mockRejectedValue(apiError(0, { code: 'network_error' }));
    const { wrapper } = setup();
    const { result } = await renderHook(() => useJob(id), { wrapper });
    await vi.waitFor(() => expect(getJob).toHaveBeenCalledTimes(1));
    expect(result.current.connectionProblem).toBe(false);

    // 4 s, 8 s, then 10 s per retry.
    await tick(4000);
    await vi.waitFor(() => expect(getJob).toHaveBeenCalledTimes(2));
    await tick(8000);
    await vi.waitFor(() => expect(getJob).toHaveBeenCalledTimes(3));
    await tick(10_000);
    await vi.waitFor(() => expect(getJob).toHaveBeenCalledTimes(4));
    expect(result.current.connectionProblem).toBe(false);
    await tick(10_000);
    await vi.waitFor(() => expect(getJob).toHaveBeenCalledTimes(5));
    await vi.waitFor(() => expect(result.current.connectionProblem).toBe(true));
    expect(result.current.isActive).toBe(true);

    vi.mocked(getJob).mockResolvedValue(testJob({ id, status: 'running' }));
    await tick(10_000);
    await vi.waitFor(() =>
      expect(result.current.connectionProblem).toBe(false),
    );
  });

  it('does nothing without a job ID', async () => {
    const { wrapper } = setup();
    const { result } = await renderHook(() => useJob(null), { wrapper });
    await tick(5000);
    expect(getJob).not.toHaveBeenCalled();
    expect(result.current).toEqual({
      job: null,
      isActive: false,
      isTerminal: false,
      connectionProblem: false,
      notFound: false,
    });
  });
});

describe('useActiveJob', () => {
  beforeEach(() => vi.clearAllMocks());

  it('finds the newest queued or running job of the kinds on the target', async () => {
    const running = testJob({ id: 'active-1', kind: 'system.ai_test' });
    vi.mocked(listJobs).mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [running],
    });
    const { wrapper } = setup();
    const { result } = await renderHook(
      () =>
        useActiveJob({
          account: 'none',
          kinds: ['system.ai_test'],
          targetType: 'system',
          targetId: 'ai',
        }),
      { wrapper },
    );
    await vi.waitFor(() => expect(result.current.data).toEqual(running));
    expect(listJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        account: 'none',
        kind: ['system.ai_test'],
        status: ['queued', 'running'],
        target_type: 'system',
        target_id: 'ai',
        page_size: 1,
      }),
    );
  });

  it('waits while the account is unknown', async () => {
    const { wrapper } = setup();
    await renderHook(() => useActiveJob({ account: null, kinds: ['x.y'] }), {
      wrapper,
    });
    expect(listJobs).not.toHaveBeenCalled();
  });
});
