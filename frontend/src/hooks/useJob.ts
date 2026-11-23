import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { isApiError } from '@/services/socialhub/http';
import {
  getJob,
  isActive,
  isTerminal,
  type Job,
  type JobStatus,
  listJobs,
} from '@/services/socialhub/jobs';

export type UseJobOptions = {
  /** Called once when the job succeeds. */
  onDone?: (job: Job) => void;
  /** Called once when the job fails or is cancelled. */
  onFailed?: (job: Job) => void;
  /** Poll interval while the job is queued or running; default 2 s (API.md "Long actions"). */
  intervalMs?: number;
};

export type UseJobResult = {
  job: Job | null;
  /** True from the moment a job ID is given until the job ends (or turns out not to exist). */
  isActive: boolean;
  isTerminal: boolean;
  /** Five failed polls in a row; polling continues with a longer interval. */
  connectionProblem: boolean;
  /** `404`: the job does not exist (or is a system job this user may not see). */
  notFound: boolean;
};

export const MAX_BACKOFF_MS = 10_000;
export const CONNECTION_PROBLEM_AFTER = 5;

/**
 * Consecutive failed polls per job ID. Module-level because several components can follow the
 * same job (they share one TanStack query, so only one of them runs each fetch).
 */
const failures = new Map<string, number>();

const isNotFound = (error: unknown) =>
  isApiError(error) && error.status === 404;

/** The poll interval after `failed` consecutive failures: doubles up to 10 seconds. */
export function backoffInterval(intervalMs: number, failed: number): number {
  if (failed <= 0) return intervalMs;
  return Math.min(intervalMs * 2 ** failed, MAX_BACKOFF_MS);
}

/**
 * Follows a job until it ends (E00-S06 "Data layer"). Query key `['job', jobId]`.
 *
 * - Polls every `intervalMs` while the job is `queued` or `running` and stops when it ends.
 *   Polling pauses while the tab is hidden (TanStack's `refetchIntervalInBackground: false`).
 * - Calls `onDone` / `onFailed` once per job, and only for a job this hook saw unfinished, so a
 *   re-render or a remount over an already finished job never calls them again.
 * - On errors it keeps polling with a doubling interval up to 10 s; after five failures in a row
 *   `connectionProblem` is true. A `404` stops polling and sets `notFound`.
 */
export function useJob(
  jobId: string | null | undefined,
  options: UseJobOptions = {},
): UseJobResult {
  const { intervalMs = 2000 } = options;
  const id = jobId || null;
  const callbacks = useRef(options);
  callbacks.current = options;

  const query = useQuery({
    queryKey: ['job', id],
    queryFn: async () => {
      const key = id as string;
      try {
        const job = await getJob(key);
        failures.set(key, 0);
        return job;
      } catch (error) {
        if (!isNotFound(error)) failures.set(key, (failures.get(key) ?? 0) + 1);
        throw error;
      }
    },
    enabled: id !== null,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (q) => {
      if (isNotFound(q.state.error)) return false;
      if (isTerminal(q.state.data?.status)) return false;
      return backoffInterval(intervalMs, failures.get(id as string) ?? 0);
    },
  });

  const notFound = id !== null && isNotFound(query.error);
  const job = id !== null ? (query.data ?? null) : null;
  const status: JobStatus | undefined = job?.status;

  // Whether this hook saw the current job unfinished (or not yet loaded).
  const seen = useRef<{ id: string | null; unfinished: boolean }>({
    id: null,
    unfinished: false,
  });
  if (seen.current.id !== id) seen.current = { id, unfinished: false };
  if (id !== null && !notFound && !isTerminal(status)) {
    seen.current.unfinished = true;
  }
  const fired = useRef<string | null>(null);

  useEffect(() => {
    if (!job || !isTerminal(job.status) || !seen.current.unfinished) return;
    if (fired.current === job.id) return;
    fired.current = job.id;
    if (job.status === 'succeeded') callbacks.current.onDone?.(job);
    else callbacks.current.onFailed?.(job);
  }, [job]);

  return {
    job,
    isActive: id !== null && !notFound && (!job || isActive(status)),
    isTerminal: isTerminal(status),
    connectionProblem:
      id !== null &&
      !notFound &&
      (failures.get(id) ?? 0) >= CONNECTION_PROBLEM_AFTER,
    notFound,
  };
}

export type UseActiveJobParams = {
  /**
   * The account to look in. `'none'` looks at system jobs (admins); `null` waits (the query is
   * disabled until an account is known).
   */
  account: number | 'none' | null;
  kinds: string[];
  targetType?: string;
  targetId?: string;
};

/**
 * For resources without an `active_job` field: the newest queued or running job of `kinds` on the
 * target, so a job started before a reload is picked up again (E00-S06 "Data layer").
 * `data` is the job or `null`.
 */
export function useActiveJob({
  account,
  kinds,
  targetType,
  targetId,
}: UseActiveJobParams) {
  return useQuery({
    queryKey: [account, 'active-job', kinds, targetType, targetId],
    enabled: account !== null,
    queryFn: async () => {
      const page = await listJobs({
        account: account as number | 'none',
        kind: kinds,
        status: ['queued', 'running'],
        target_type: targetType,
        target_id: targetId,
        ordering: '-created_at',
        page_size: 1,
      });
      return page.results[0] ?? null;
    },
  });
}
