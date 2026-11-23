/**
 * AI call log (E00-S05, `GET /ai/runs/`). Admin only; `account` is optional because system calls
 * have none.
 */
import { api, type Page } from './http';

export type AiRunStatus = 'ok' | 'error' | 'refused';

export type AiRun = {
  id: number;
  created_at: string;
  job: string | null;
  account: number | null;
  provider: string;
  model: string;
  task: string;
  prompt_version: string;
  input_tokens: number;
  output_tokens: number;
  /** Provider units beyond plain tokens (cache, web searches, images, attempts, fallback). */
  units: Record<string, unknown>;
  /** Decimal string, for example `"0.041900"`. */
  cost_usd: string;
  latency_ms: number;
  status: AiRunStatus;
  error_code: string | null;
  provider_request_id: string | null;
};

export type AiRunDetail = AiRun & {
  /** Null once pruned after 30 days. */
  payload: {
    request?: unknown;
    response?: unknown;
    truncated?: boolean;
  } | null;
};

export type AiRunTotals = {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: string;
};

export type AiRunPage = Page<AiRun> & { totals: AiRunTotals };

export type AiRunOrdering = '-created_at' | 'created_at' | '-cost_usd' | '-latency_ms';

export type AiRunListParams = {
  account?: number;
  task?: string;
  provider?: string;
  status?: AiRunStatus;
  job?: string;
  created_after?: string;
  created_before?: string;
  ordering?: AiRunOrdering;
  page?: number;
  page_size?: number;
};

export const listAiRuns = (params: AiRunListParams = {}) =>
  api.get<AiRunPage>('/ai/runs/', params);

export const getAiRun = (id: number) => api.get<AiRunDetail>(`/ai/runs/${id}/`);

/** Provider names as the panel shows them. */
export const AI_PROVIDER_LABEL: Record<string, string> = {
  anthropic: 'Claude',
  openai: 'OpenAI',
  fake: 'Fake (local testing)',
};

export const aiProviderLabel = (provider: string | null | undefined) =>
  provider ? (AI_PROVIDER_LABEL[provider] ?? provider) : '—';
