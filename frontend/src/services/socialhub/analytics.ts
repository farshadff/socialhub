/** Analytics snapshots and follower tracking (E09). Shapes follow E09-S01..S03. */
import type { Metric } from './plans';
import { api, type Page, type QueryParams } from './http';
import type { Job } from './jobs';
import type { Format } from './formats';
import { withAccount } from '@/utils/accountRequest';

export type MetricsStatus =
  | 'incomplete'
  | 'collecting'
  | 'overdue'
  | 'needs_manual_entry'
  | 'complete';
export type CheckpointStatus = 'captured' | 'skipped' | 'due' | 'overdue' | 'upcoming';
export type SnapshotSource = 'provider' | 'manual';
export type MetricValues = Partial<Record<Metric, number | null>>;

export type MetricSnapshot = MetricValues & {
  id?: number;
  snapshot?: number;
  checkpoint: string;
  status?: 'captured' | 'skipped';
  captured_at: string;
  age_minutes: number;
  on_time?: boolean;
  source: SnapshotSource;
  unavailable: Metric[];
};

export type AnalyticsPostRow = {
  publication: number;
  content_item: { id: number; title: string };
  plan: number | null;
  format: Format;
  published_at: string;
  published_via: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
  age_minutes: number;
  latest: MetricSnapshot | null;
  next_metrics_checkpoint: string | null;
  next_metrics_at: string | null;
  metrics_status: MetricsStatus;
  latest_evaluation?: {
    verdict: 'outperforming' | 'on_par' | 'underperforming' | 'insufficient_data';
    checkpoint: string;
    is_final: boolean;
    baseline_ratio: string | null;
    goal_result: 'met' | 'missed' | 'no_goal' | 'not_measured';
    goal_target: number | null;
  } | null;
};

export type AnalyticsCheckpoint = {
  checkpoint: string;
  target_at: string;
  is_final: boolean;
  status: CheckpointStatus;
  skip_reason: string | null;
  snapshot: MetricSnapshot | null;
};

export type AnalyticsPostDetail = {
  publication: number;
  account: number;
  content_item: { id: number; title: string };
  format: Format;
  published_at: string;
  published_via: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
  applicable_metrics: Metric[];
  insights_source: 'provider' | 'manual' | string;
  metrics_status: MetricsStatus;
  checkpoints: AnalyticsCheckpoint[];
  adhoc: MetricSnapshot[];
  last_synced_at: string | null;
};

export type AccountAnalyticsPoint = {
  date: string;
  followers: number;
  following: number | null;
  media_count: number | null;
  follower_change: number | null;
  source: SnapshotSource;
  captured_at: string;
};

export type AccountAnalytics = {
  account: number;
  timezone: string;
  from: string;
  to: string;
  points: AccountAnalyticsPoint[];
  missing_dates: string[];
  period: {
    start: { date: string; followers: number };
    end: { date: string; followers: number };
    change: number;
    exact: boolean;
  } | null;
  current: { date: string; followers: number } | null;
  insights_source: 'provider' | 'manual' | string;
};

export type AnalyticsSyncStatus = {
  account: number;
  insights_source: string;
  metrics_last_snapshot_at: string | null;
  metrics_overdue: number;
  metrics_oldest_overdue_at: string | null;
  needs_manual_entry: number;
  collector: {
    last_success_at: string | null;
    last_error_code: string | null;
    last_error_at: string | null;
    consecutive_failures: number;
  };
  followers_last_snapshot_date: string | null;
  followers_overdue: boolean;
};

export const listAnalyticsPosts = (params: {
  plan?: number;
  format?: Format[];
  published_after?: string;
  published_before?: string;
  metrics_status?: MetricsStatus[];
  verdict?: string[];
  ordering?: string;
  page?: number;
  page_size?: number;
}) => api.get<Page<AnalyticsPostRow>>('/analytics/posts/', withAccount(params as QueryParams));

export const getAnalyticsPost = (publicationId: number | string) =>
  api.get<AnalyticsPostDetail>(`/analytics/posts/${publicationId}/`);

export const getAccountAnalytics = (params: { from: string; to: string }) =>
  api.get<AccountAnalytics>('/analytics/account/', withAccount(params as QueryParams));

export const getAnalyticsSyncStatus = () =>
  api.get<AnalyticsSyncStatus>('/analytics/sync-status/', withAccount({} as QueryParams));

export const refreshAnalytics = (publication?: number) =>
  api.post<{ job: Job }>('/analytics/refresh/', withAccount({ publication }));

export const createMetricSnapshot = (
  publicationId: number | string,
  body: {
    checkpoint: string;
    captured_at?: string;
    reach?: number;
    views?: number;
    likes?: number;
    comments?: number;
    saves?: number;
    shares?: number;
    replies?: number;
    replace?: boolean;
  },
) => api.post<{
  snapshot: MetricSnapshot;
  replaced: boolean;
  evaluation_reset: boolean;
  next_metrics_checkpoint: string | null;
  next_metrics_at: string | null;
}>(`/analytics/posts/${publicationId}/snapshots/`, body);

export const createFollowerSnapshot = (body: {
  date: string;
  followers: number;
  following?: number;
  media_count?: number;
  replace?: boolean;
}) => api.post<AccountAnalyticsPoint & { replaced: boolean }>(
  '/analytics/account/snapshots/',
  withAccount(body),
);
