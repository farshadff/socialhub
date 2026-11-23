/**
 * Settings → System (E00-S05, docs/epics/E00-foundation/S05-ai-gateway.md). Admin only; not
 * account-scoped. The `storage` block is filled by E00-S06 and the `instagram` block by E00-S04;
 * until those land the API returns them as `null`.
 */
import { api } from './http';
import type { JobStarted } from './jobs';

export type DependencyState = 'ok' | 'unavailable' | 'unknown';

export type AiTextProvider = 'anthropic' | 'fake' | string;
export type AiImageProvider = 'openai' | 'fake' | string;

export type AiProviderStatus = {
  provider: string;
  configured: boolean;
  /** Setting names that are missing, for example `ANTHROPIC_API_KEY`. */
  missing: string[];
  model: string;
  /** Text only: per-task model overrides. */
  overrides?: Record<string, string>;
};

export type InstagramStatus = {
  default_provider: string;
  allowed_providers: string[];
  meta_app: {
    configured: boolean;
    missing: string[];
    app_id: string | null;
    redirect_uri: string | null;
  };
  api_version: string | null;
  http_proxy: boolean;
  token_refresh_after_days: number;
  media_url_ttl_seconds: number;
  encryption_key_configured: boolean;
};

export type StorageStatus = {
  backend: 'local' | 's3' | string;
  bucket: string | null;
  public_base_url: string | null;
};

export type SystemStatus = {
  release?: string;
  app: { version: string; environment: string; debug: boolean };
  dependencies: { database: DependencyState; redis: DependencyState };
  workers: Record<'default' | 'render' | 'publish', DependencyState>;
  ai: {
    text: AiProviderStatus;
    image: AiProviderStatus;
    models_without_price: string[];
    max_calls_per_job: number;
    timeout_seconds: number;
  };
  instagram: InstagramStatus | null;
  storage: StorageStatus | null;
};

export const getSystemStatus = () => api.get<SystemStatus>('/system/status/');

export type AiTestProvider = 'text' | 'image';

/** One provider's outcome in a finished `system.ai_test` job's `result`. */
export type AiTestOutcome = {
  ok: boolean;
  provider: string;
  model: string;
  latency_ms: number;
  ai_run_id: number | null;
  error_code: string | null;
  error_detail: string | null;
};

export type AiTestResult = Partial<Record<AiTestProvider, AiTestOutcome>>;

export const AI_TEST_KIND = 'system.ai_test';

/** Starts a `system.ai_test` job (`202`). Both providers unless `providers` narrows it. */
export const startAiTest = (providers?: AiTestProvider[]) =>
  api.post<JobStarted>('/system/ai-test/', providers ? { providers } : {});
