import { api, type Page } from './http';
import type { Job, JobStatus } from './jobs';

export type SourceKind = 'web_search' | 'rss';
export type SignalKind = SourceKind | 'manual';
export type Format = 'reel' | 'story' | 'feed_post';
export type TopicStatus = 'new' | 'shortlisted' | 'dismissed' | 'used';
export type TopicOrigin = 'ai' | 'manual';
export type RunStatus = 'running' | 'completed' | 'failed';

export const FORMATS: Format[] = ['reel', 'story', 'feed_post'];

export type ResearchSource = {
  id: number;
  account: number;
  kind: SourceKind;
  value: string;
  label: string;
  active: boolean;
  last_run_at: string | null;
  last_status: string | null;
  available: boolean;
  unavailable_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type SignalMetrics = { likes?: number; comments?: number; views?: number };

export type TrendSignal = {
  id: number;
  account: number;
  run: number | null;
  source: { id: number; kind: SourceKind; label: string } | null;
  kind: SignalKind;
  url: string;
  title: string;
  excerpt: string;
  author: string;
  published_at: string | null;
  captured_at: string;
  metrics: SignalMetrics;
  topic_ids: number[];
};

export type EvidenceBreakdown = {
  signal_count: number;
  source_diversity: number;
  recency: number;
  engagement: number;
};

export type TrendTopic = {
  id: number;
  account: number;
  plan: number | null;
  run: number | null;
  title: string;
  summary: string;
  why_now: string;
  hooks: string[];
  suggested_formats: Format[];
  keywords: string[];
  evidence_score: number;
  evidence_breakdown: EvidenceBreakdown;
  signal_count: number;
  status: TopicStatus;
  origin: TopicOrigin;
  created_at: string;
  updated_at: string;
};

export type TrendTopicDetail = TrendTopic & { signals: TrendSignal[] };

export type SourceResult = { signals: number; duplicates: number; status: string };

export type RunStats = {
  signals?: number;
  duplicates?: number;
  topics?: number;
  dropped_topics?: number;
  synthesis?: 'done' | 'skipped_too_few_signals' | 'skipped';
  by_source?: Record<string, SourceResult>;
};

export type ResearchRun = {
  id: number;
  account: number;
  plan: number | null;
  status: RunStatus;
  params: {
    lookback_days: number;
    source_ids: number[] | null;
    collect: boolean;
    synthesize: boolean;
  };
  stats: RunStats;
  started_at: string;
  finished_at: string | null;
  job: {
    id: string;
    status: JobStatus;
    progress: number;
    message: string;
    error_code: string | null;
  } | null;
  started_by: { id: number; name: string } | null;
};

export type ResearchRunDetail = ResearchRun & {
  sources: Array<
    SourceResult & { source_id: number; kind: SourceKind | null; label: string | null }
  >;
};

type ListParams = { page?: number; page_size?: number; ordering?: string };

// Sources (E02-S01)
export const listSources = (
  params: ListParams & { account: number; kind?: SourceKind[]; active?: boolean },
) => api.get<Page<ResearchSource>>('/research/sources/', params);

export const createSource = (body: {
  account: number;
  kind: SourceKind;
  value: string;
  label?: string;
  active?: boolean;
}) => api.post<ResearchSource>('/research/sources/', body);

export const updateSource = (
  id: number,
  body: Partial<Pick<ResearchSource, 'value' | 'label' | 'active'>>,
) => api.patch<ResearchSource>(`/research/sources/${id}/`, body);

export const deleteSource = (id: number) => api.delete(`/research/sources/${id}/`);

// Runs (E02-S02)
export type StartRunBody = {
  account: number;
  plan?: number | null;
  source_ids?: number[];
  lookback_days?: number;
  collect?: boolean;
  synthesize?: boolean;
};

export const startRun = (body: StartRunBody) =>
  api.post<{ job: Job }>('/research/runs/', body);

export const listRuns = (
  params: ListParams & { account: number; plan?: number; status?: RunStatus[] },
) => api.get<Page<ResearchRun>>('/research/runs/', params);

export const getRun = (id: number) =>
  api.get<ResearchRunDetail>(`/research/runs/${id}/`);

// Signals (E02-S02)
export type SignalListParams = ListParams & {
  account: number;
  /** Assumed filter: one signal by ID, used by "Show it" after a duplicate. */
  id?: number;
  run?: number;
  source?: number;
  kind?: SignalKind[];
  topic?: number;
  unassigned?: boolean;
  q?: string;
  captured_after?: string;
  captured_before?: string;
};

export const listSignals = (params: SignalListParams) =>
  api.get<Page<TrendSignal>>('/research/signals/', params);

export type CreateSignalBody = {
  account: number;
  url?: string;
  title: string;
  excerpt?: string;
  author?: string;
  published_at?: string | null;
  metrics?: SignalMetrics;
  topic?: number | null;
};

export const createSignal = (body: CreateSignalBody) =>
  api.post<TrendSignal>('/research/signals/', body);

// Topics (E02-S04, E02-S05)
export type TopicListParams = ListParams & {
  account: number;
  plan?: number | 'none';
  run?: number;
  status?: TopicStatus[];
  origin?: TopicOrigin;
  min_evidence?: number;
  q?: string;
};

export const listTopics = (params: TopicListParams) =>
  api.get<Page<TrendTopic>>('/research/topics/', params);

export type TopicContent = {
  title: string;
  summary?: string;
  why_now?: string;
  hooks?: string[];
  suggested_formats?: Format[];
  keywords?: string[];
};

export const createTopic = (
  body: TopicContent & { account: number; plan?: number | null; signal_ids?: number[] },
) => api.post<TrendTopicDetail>('/research/topics/', body);

export const getTopic = (id: number) =>
  api.get<TrendTopicDetail>(`/research/topics/${id}/`);

export const updateTopic = (
  id: number,
  body: Partial<TopicContent> & {
    status?: Exclude<TopicStatus, 'used'>;
    signal_ids?: number[];
    plan?: number | null;
  },
) => api.patch<TrendTopicDetail>(`/research/topics/${id}/`, body);
