import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { getJob, listJobs } from '@/services/socialhub/jobs';
import {
  getSystemStatus,
  type SystemStatus,
  startAiTest,
} from '@/services/socialhub/system';
import { testJob, testModel, withQueryClient } from '@/utils/testing';
import StatusTab, { aiTestLine } from './StatusTab';

vi.mock('@umijs/max', () => ({
  useModel: (name: string) => testModel(name),
  Link: ({ to, children }: any) => <a href={to}>{children}</a>,
}));
vi.mock('@/services/socialhub/system', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/system')>()),
  getSystemStatus: vi.fn(),
  startAiTest: vi.fn(),
}));
vi.mock('@/services/socialhub/jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/jobs')>()),
  getJob: vi.fn(),
  listJobs: vi.fn(),
}));

const base = (): SystemStatus => ({
  app: { version: '0.1.0', environment: 'production', debug: false },
  dependencies: { database: 'ok', redis: 'ok' },
  workers: { default: 'ok', render: 'ok', publish: 'unknown' },
  ai: {
    text: {
      provider: 'anthropic',
      configured: true,
      missing: [],
      model: 'claude-opus-5-5',
      overrides: {},
    },
    image: {
      provider: 'openai',
      configured: false,
      missing: ['OPENAI_API_KEY'],
      model: '',
    },
    models_without_price: [],
    max_calls_per_job: 20,
    timeout_seconds: 180,
  },
  instagram: {
    default_provider: 'graph_api',
    allowed_providers: ['graph_api', 'manual'],
    meta_app: {
      configured: true,
      missing: [],
      app_id: '1234567890123456',
      redirect_uri:
        'https://social.example.com/api/v1/instagram/oauth/callback/',
    },
    api_version: 'v25.0',
    http_proxy: false,
    token_refresh_after_days: 7,
    media_url_ttl_seconds: 7200,
    encryption_key_configured: true,
  },
  storage: { backend: 's3', bucket: 'socialhub-media', public_base_url: null },
});

const noJobs = { count: 0, next: null, previous: null, results: [] };

describe('System status tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listJobs).mockResolvedValue(noJobs);
  });

  it('shows configured and missing providers and every card', async () => {
    vi.mocked(getSystemStatus).mockResolvedValue(base());
    const screen = await render(withQueryClient(<StatusTab />));
    await expect.element(screen.getByText('claude-opus-5-5')).toBeVisible();
    await expect
      .element(screen.getByText('Claude', { exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByText('Missing OPENAI_API_KEY'))
      .toBeVisible();
    await expect.element(screen.getByText('Ready').first()).toBeVisible();
    await expect
      .element(screen.getByText('Instagram API', { exact: true }))
      .toBeVisible();
    await expect.element(screen.getByText('v25.0')).toBeVisible();
    await expect.element(screen.getByText('S3-compatible')).toBeVisible();
    await expect.element(screen.getByText('socialhub-media')).toBeVisible();
    await expect
      .element(
        screen.getByText(
          'Makes one small call to each provider. Real providers charge for it.',
        ),
      )
      .toBeVisible();
    expect(screen.container.textContent).toContain('Unknown');
  });

  it('shows fake providers, unpriced models and blocks not reported yet', async () => {
    const status = base();
    status.ai.text = {
      provider: 'fake',
      configured: true,
      missing: [],
      model: '',
    };
    status.ai.image = {
      provider: 'fake',
      configured: true,
      missing: [],
      model: '',
    };
    status.ai.models_without_price = ['claude-haiku-5-5'];
    status.instagram = null;
    status.storage = null;
    vi.mocked(getSystemStatus).mockResolvedValue(status);
    const screen = await render(withQueryClient(<StatusTab />));
    await expect
      .element(screen.getByText('Fake (local testing)').first())
      .toBeVisible();
    await expect
      .element(
        screen.getByText(
          'No price is set for claude-haiku-5-5; their cost is recorded as 0.',
        ),
      )
      .toBeVisible();
    await expect
      .element(screen.getByText('Not reported yet.').first())
      .toBeVisible();
    expect(screen.container.textContent).not.toContain('Missing');
  });

  it('runs the AI test with JobButton and lists each provider outcome', async () => {
    vi.mocked(getSystemStatus).mockResolvedValue(base());
    vi.mocked(startAiTest).mockResolvedValue({
      job: testJob({ id: 'ai-test-1', status: 'queued' }),
    });
    vi.mocked(getJob).mockResolvedValue(
      testJob({
        id: 'ai-test-1',
        status: 'succeeded',
        progress: 100,
        result: {
          text: {
            ok: true,
            provider: 'anthropic',
            model: 'claude-opus-5-5',
            latency_ms: 1840,
            ai_run_id: 311,
            error_code: null,
            error_detail: null,
          },
          image: {
            ok: false,
            provider: 'openai',
            model: '',
            latency_ms: 0,
            ai_run_id: 312,
            error_code: 'provider_not_configured',
            error_detail: 'OPENAI_API_KEY is not set.',
          },
        },
      }),
    );
    const screen = await render(withQueryClient(<StatusTab />));
    await screen.getByRole('button', { name: 'Run AI test' }).click();
    await expect
      .element(screen.getByText('Claude replied in 1.8 s'))
      .toBeVisible();
    await expect.element(screen.getByText(/^OpenAI failed:/)).toBeVisible();
    await expect
      .element(screen.getByText('OPENAI_API_KEY is not set.'))
      .toBeVisible();
    expect(startAiTest).toHaveBeenCalledTimes(1);
    // The status reloads after the test.
    await vi.waitFor(() => expect(getSystemStatus).toHaveBeenCalledTimes(2));
  });
});

describe('aiTestLine', () => {
  it('words a success and a failure', () => {
    expect(
      aiTestLine({
        ok: true,
        provider: 'fake',
        model: '',
        latency_ms: 20,
        ai_run_id: 1,
        error_code: null,
        error_detail: null,
      }).text,
    ).toBe('Fake (local testing) replied in 0.0 s');
    expect(
      aiTestLine({
        ok: false,
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        latency_ms: 0,
        ai_run_id: 2,
        error_code: 'provider_error',
        error_detail: 'overloaded',
      }),
    ).toEqual({
      ok: false,
      text: 'Claude failed: An external service failed. Try again in a few minutes.',
      detail: 'overloaded',
    });
  });
});
