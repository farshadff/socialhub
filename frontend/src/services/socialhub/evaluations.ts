import { api, type Page } from './http';
import type { JobStarted } from './jobs';
import type { Format } from './formats';

export type EvaluationMetric =
  | 'reach'
  | 'views'
  | 'likes'
  | 'comments'
  | 'saves'
  | 'shares'
  | 'replies';
export type EvaluationCheckpoint = '24h' | '7d' | '23h';
export type EvaluationVerdict =
  | 'outperforming'
  | 'on_par'
  | 'underperforming'
  | 'insufficient_data';
export type GoalResult = 'met' | 'missed' | 'no_goal' | 'not_measured';

export type EvaluationMetricRow = {
  value: number | null;
  baseline: number | null;
  ratio: number | null;
  goal: number | null;
  sample_size: number;
  unavailable?: boolean;
};

export type EvaluationRow = {
  id: number;
  publication: number;
  content_item: number;
  plan: number | null;
  title: string;
  format: Format;
  permalink: string | null;
  published_at: string;
  checkpoint: EvaluationCheckpoint;
  is_final: boolean;
  primary_metric: EvaluationMetric;
  value: number | null;
  goal_target: number | null;
  goal_source: 'per_post_format' | 'per_post_all' | 'week_total_share' | 'none';
  goal_result: GoalResult;
  baseline_value: string | null;
  baseline_sample_size: number;
  baseline_ratio: string | null;
  verdict: EvaluationVerdict;
  repurpose_task: number | null;
  evaluated_at: string;
};

export type EvaluationDetail = EvaluationRow & {
  metrics: Record<EvaluationMetric, EvaluationMetricRow>;
  baseline_samples: { publication: number; value: number }[];
};

export type EvaluationListParams = {
  account: number;
  plan?: number;
  publication?: number;
  checkpoint?: EvaluationCheckpoint;
  verdict?: EvaluationVerdict[];
  goal_result?: GoalResult[];
  format?: Format[];
  final?: boolean;
  ordering?: 'evaluated_at' | '-evaluated_at' | 'baseline_ratio' | '-baseline_ratio' | 'published_at' | '-published_at';
  page?: number;
  page_size?: number;
};

export const listEvaluations = (params: EvaluationListParams) =>
  api.get<Page<EvaluationRow>>('/evaluations/', params);

export const getEvaluation = (id: number) =>
  api.get<EvaluationDetail>(`/evaluations/${id}/`);

export const runEvaluations = (body: {
  account: number;
  publication?: number;
  plan?: number;
  force?: boolean;
}) => api.post<JobStarted>('/evaluations/run/', body);
