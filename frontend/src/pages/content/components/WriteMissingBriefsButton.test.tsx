import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { apiError, modelFor, page1, withQueryClient } from '@/pages/content/workspace/tabs/brief/testFixtures';
import { generatePlanBriefs } from '@/services/socialhub/briefs';
import { getPlanForContent } from '@/services/socialhub/content';
import { listJobs } from '@/services/socialhub/jobs';
import WriteMissingBriefsButton from './WriteMissingBriefsButton';

vi.mock('@umijs/max', () => ({
  useModel: (name: string) => modelFor(name),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
  history: {},
}));
vi.mock('@/services/socialhub/briefs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/briefs')>()),
  generatePlanBriefs: vi.fn(),
}));
vi.mock('@/services/socialhub/content', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/content')>()),
  getPlanForContent: vi.fn(),
}));
vi.mock('@/services/socialhub/jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/jobs')>()),
  listJobs: vi.fn(),
  getJob: vi.fn(),
}));

const plan = (status: 'draft' | 'active' | 'closed') => ({
  id: 12,
  title: 'Week of 28 Nov',
  week_start: '2026-11-28',
  status,
});

describe('WriteMissingBriefsButton (E04-S03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listJobs).mockResolvedValue(page1([]));
  });

  it('renders nothing for "All plans" or a plan that is not active', async () => {
    vi.mocked(getPlanForContent).mockResolvedValue(plan('closed'));
    const screen = await render(withQueryClient(<WriteMissingBriefsButton planId={12} onDone={vi.fn()} />));
    await vi.waitFor(() => expect(getPlanForContent).toHaveBeenCalled());
    expect(screen.container.querySelector('button')).toBeNull();

    const empty = await render(withQueryClient(<WriteMissingBriefsButton planId={null} onDone={vi.fn()} />));
    expect(empty.container.querySelector('button')).toBeNull();
  });

  it('explains when every item already has a brief', async () => {
    vi.mocked(getPlanForContent).mockResolvedValue(plan('active'));
    vi.mocked(generatePlanBriefs).mockRejectedValue(
      apiError(400, {
        code: 'validation_error',
        fields: [{ path: 'content_items', code: 'nothing_to_do', message: '…' }],
        details: { skipped: [{ content_item: 47, reason: 'has_approved_brief' }] },
      }),
    );
    await render(withQueryClient(<WriteMissingBriefsButton planId={12} onDone={vi.fn()} />));
    await page.getByRole('button', { name: 'Write missing briefs' }).click();
    await expect
      .element(page.getByText('Every selected item already has a brief or one is being written.'))
      .toBeVisible();
  });
});
