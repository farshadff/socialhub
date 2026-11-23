/**
 * Background jobs (E00-S06, docs/epics/E00-foundation/S06-jobs-and-media-storage.md and API.md
 * "Long actions"). Endpoints that start work answer `202 {"job": Job}`; the panel follows the job
 * with `useJob` (src/hooks/useJob.ts), `JobButton` and `JobProgress`.
 */
import { api, type Page } from './http';

export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

/**
 * `active_job` on resources that can have running work: `{id, kind, status, progress, message}`.
 * `kind` is optional and `error_code` allowed so a full `Job` and older embeds fit too.
 */
export type JobSummary = {
  id: string;
  kind?: string;
  status: JobStatus;
  progress: number;
  message: string;
  error_code?: string | null;
};

export type JobUser = { id: number; name: string };

/** The full job shape (rule 22). */
export type Job = JobSummary & {
  kind: string;
  account: number | null;
  queue: string;
  target_type: string;
  target_id: string;
  result: Record<string, any> | null;
  error_code: string | null;
  error_detail: string | null;
  created_by: JobUser | null;
  request_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

/** What every job-starting endpoint returns with `202`. */
export type JobStarted = { job: Job };

export const TERMINAL_STATUSES: JobStatus[] = [
  'succeeded',
  'failed',
  'cancelled',
];

export const ACTIVE_STATUSES: JobStatus[] = ['queued', 'running'];

export const isTerminal = (status: JobStatus | undefined | null) =>
  !!status && TERMINAL_STATUSES.includes(status);

export const isActive = (status: JobStatus | undefined | null) =>
  status === 'queued' || status === 'running';

export type JobOrdering =
  | 'created_at'
  | '-created_at'
  | 'finished_at'
  | '-finished_at';

export type JobListParams = {
  /**
   * Required for operators. Admins may omit it to list across accounts, or send `'none'` for
   * system jobs only (rule 20).
   */
  account?: number | 'none';
  /** Exact kinds, sent comma-separated. */
  kind?: string[];
  kind_prefix?: string;
  status?: JobStatus[];
  target_type?: string;
  target_id?: string;
  created_after?: string;
  created_before?: string;
  ordering?: JobOrdering;
  page?: number;
  page_size?: number;
};

export const getJob = (id: string) => api.get<Job>(`/jobs/${id}/`);

export const listJobs = (params: JobListParams = {}) =>
  api.get<Page<Job>>('/jobs/', params);

/** Display names for the job kinds the panel knows; others are derived from the kind. */
export const JOB_KIND_LABEL: Record<string, string> = {
  'system.ai_test': 'AI test',
  'instagram.verify': 'Connection check',
  'instagram.refresh_token': 'Token refresh',
  'research.run': 'Research',
  'feeds.sync': 'Feed sync',
  'selection.rank': 'Ranking',
  'brief.generate': 'Brief',
  'brief.generate_batch': 'Briefs for a plan',
  'script.generate': 'Script',
  'production.start': 'Production',
  'production.render': 'Rendering',
  'production.generate_image': 'Image generation',
  'copy.generate': 'Caption draft',
  'qc.run': 'Checks',
  'qc.revise': 'Automatic revision',
  'publish.send': 'Publishing',
  'publish.verify': 'Publication check',
  'analytics.refresh': 'Metrics refresh',
  'evaluation.run': 'Evaluation',
  'report.weekly': 'Weekly report',
  'repurpose.suggest': 'Repurpose suggestion',
};

/** `production.render` → "Rendering"; an unknown `foo.bar_baz` → "Foo bar baz". */
export function jobKindLabel(kind: string | null | undefined): string {
  if (!kind) return 'Task';
  const known = JOB_KIND_LABEL[kind];
  if (known) return known;
  const words = kind.replace(/[._]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
