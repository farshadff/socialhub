import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { searchAccounts } from '@/services/socialhub/accounts';
import {
  type AiRun,
  type AiRunPage,
  getAiRun,
  listAiRuns,
} from '@/services/socialhub/ai';
import { TEST_ACCOUNT, testModel, withQueryClient } from '@/utils/testing';
import AiCallsTab, { totalsLine } from './AiCallsTab';

vi.mock('@umijs/max', () => ({
  useModel: (name: string) => testModel(name),
}));
vi.mock('@/services/socialhub/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/ai')>()),
  listAiRuns: vi.fn(),
  getAiRun: vi.fn(),
}));
vi.mock('@/services/socialhub/accounts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/accounts')>()),
  searchAccounts: vi.fn(),
}));

const run = (overrides: Partial<AiRun>): AiRun => ({
  id: 318,
  created_at: '2026-11-25T11:20:14Z',
  job: 'b0f7c1f4-0c8e-4f4e-9c57-7a5a2b0d1c33',
  account: 1,
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  task: 'brief.generate',
  prompt_version: '1',
  input_tokens: 4150,
  output_tokens: 1260,
  units: { cache_read_tokens: 1900, attempts: 1, fallback_used: false },
  cost_usd: '0.041900',
  latency_ms: 9420,
  status: 'ok',
  error_code: null,
  provider_request_id: 'req_011CVx2mK9',
  ...overrides,
});

const runs: AiRunPage = {
  count: 2,
  next: null,
  previous: null,
  totals: {
    calls: 2,
    input_tokens: 4170,
    output_tokens: 1263,
    cost_usd: '0.041940',
  },
  results: [
    run({}),
    run({
      id: 311,
      account: null,
      task: 'system.ping',
      input_tokens: 20,
      output_tokens: 3,
      cost_usd: '0.000140',
      latency_ms: 1840,
      status: 'refused',
    }),
  ],
};

describe('AI calls tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(searchAccounts).mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      results: [TEST_ACCOUNT],
    });
    vi.mocked(listAiRuns).mockResolvedValue(runs);
  });

  it('words the totals line', () => {
    expect(totalsLine(runs.totals)).toBe(
      '2 calls · 4,170 tokens in · 1,263 tokens out · $0.0419',
    );
  });

  it('lists calls for the last 7 days with totals, costs and durations', async () => {
    const screen = await render(withQueryClient(<AiCallsTab />));
    await expect
      .element(
        screen.getByText(
          '2 calls · 4,170 tokens in · 1,263 tokens out · $0.0419',
        ),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole('button', { name: 'brief.generate' }))
      .toBeVisible();
    await expect.element(screen.getByText('4,150 / 1,260')).toBeVisible();
    await expect
      .element(screen.getByText('$0.0419', { exact: true }))
      .toBeVisible();
    await expect.element(screen.getByText('9.4 s')).toBeVisible();
    await expect.element(screen.getByText('Refused')).toBeVisible();
    await expect.element(screen.getByText('@greenhome.ir')).toBeVisible();
    const params = vi.mocked(listAiRuns).mock.calls[0][0] ?? {};
    expect(params.created_after).toBeTruthy();
    expect(params.created_before).toBeTruthy();
    const days =
      (Date.parse(params.created_before as string) -
        Date.parse(params.created_after as string)) /
      86_400_000;
    expect(Math.round(days)).toBe(8);
  });

  it('opens a call with its request and response', async () => {
    vi.mocked(getAiRun).mockResolvedValue({
      ...run({ id: 311, task: 'system.ping' }),
      payload: {
        request: {
          system: ['You are a connectivity check for Social Hub.'],
          user: 'Reply with the single word: pong',
        },
        response: { text: 'pong', stop_reason: 'end_turn' },
        truncated: false,
      },
    });
    const screen = await render(withQueryClient(<AiCallsTab />));
    await screen.getByRole('button', { name: 'system.ping' }).click();
    await vi.waitFor(() => expect(getAiRun).toHaveBeenCalledWith(311));
    await expect
      .element(page.getByRole('heading', { name: 'Request' }))
      .toBeVisible();
    await expect
      .element(page.getByRole('heading', { name: 'Response' }))
      .toBeVisible();
    await expect
      .element(page.getByText(/"stop_reason": "end_turn"/))
      .toBeVisible();
  });

  it('says when the payload was removed', async () => {
    vi.mocked(getAiRun).mockResolvedValue({ ...run({}), payload: null });
    const screen = await render(withQueryClient(<AiCallsTab />));
    await screen.getByRole('button', { name: 'brief.generate' }).click();
    await expect
      .element(page.getByText('Payload removed after 30 days.'))
      .toBeVisible();
  });

  it('shows the empty text', async () => {
    vi.mocked(listAiRuns).mockResolvedValue({
      ...runs,
      count: 0,
      results: [],
      totals: { calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: '0' },
    });
    const screen = await render(withQueryClient(<AiCallsTab />));
    await expect
      .element(screen.getByText('No AI calls in this period.'))
      .toBeVisible();
  });
});
