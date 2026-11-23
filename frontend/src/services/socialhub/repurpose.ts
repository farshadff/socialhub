import { api, type Page } from './http';
import type { JobSummary } from './jobs';
import type { Format } from './formats';
import type { EvaluationCheckpoint, EvaluationMetric, EvaluationVerdict } from './evaluations';

export type RepurposeStatus = 'open' | 'in_selection' | 'used' | 'dismissed';
export type RepurposeTask = {
  id: number;
  account: number;
  status: RepurposeStatus;
  source_publication: {
    id: number;
    content_item: number;
    title: string;
    format: Format;
    permalink: string | null;
    published_at: string;
  };
  evaluation: {
    id: number;
    checkpoint: EvaluationCheckpoint;
    primary_metric: EvaluationMetric;
    value: number | null;
    baseline_value: string | null;
    baseline_ratio: string | null;
    verdict: EvaluationVerdict;
  } | null;
  reason: string;
  suggested_angle: string;
  suggested_formats: Format[];
  evidence_score: number;
  candidate: { id: number; plan: number; status: string; rank: number | null } | null;
  content_item: number | null;
  created_by: { id: number; name: string } | null;
  dismiss_reason: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
  active_job?: JobSummary | null;
};
export type RepurposeListParams = {
  account: number;
  status?: RepurposeStatus[];
  source_publication?: number;
  ordering?: '-created_at' | 'created_at' | '-evidence_score' | 'expires_at';
  page?: number;
  page_size?: number;
};

export const listRepurposeTasks = (params: RepurposeListParams) =>
  api.get<Page<RepurposeTask>>('/repurpose-tasks/', params);
export const createRepurposeTask = (body: {
  source_publication: number;
  reason?: string;
  suggested_angle?: string;
  suggested_formats?: Format[];
}) => api.post<RepurposeTask & { job?: JobSummary }>('/repurpose-tasks/', body);
export const updateRepurposeTask = (
  id: number,
  body: Partial<Pick<RepurposeTask, 'reason' | 'suggested_angle' | 'suggested_formats' | 'dismiss_reason'>> & { status?: RepurposeStatus },
) => api.patch<RepurposeTask>(`/repurpose-tasks/${id}/`, body);
