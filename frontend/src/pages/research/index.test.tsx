import { message } from 'antd';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { getJob, listJobs } from '@/services/socialhub/jobs';
import { listPlans } from '@/services/socialhub/plans';
import { startRun } from '@/services/socialhub/research';
import ResearchPage, { defaultPlanId } from './index';
import { apiError, modelFor, withQueryClient } from './testUtils';

const nav = vi.hoisted(() => ({
  params: new URLSearchParams('tab=topics&plan=12'),
  setParams: vi.fn(),
}));

vi.mock('@umijs/max', () => ({
  useModel: (name: string) => modelFor(name),
  useSearchParams: () => [nav.params, nav.setParams],
  Link: ({ children }: any) => children,
}));
vi.mock('@/services/socialhub/research', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/research')>()),
  startRun: vi.fn(),
}));
vi.mock('@/services/socialhub/jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/jobs')>()),
  getJob: vi.fn(),
  listJobs: vi.fn(),
}));
vi.mock('@/services/socialhub/plans', () => ({ listPlans: vi.fn() }));
vi.mock('./TopicsTab', () => ({ default: () => <div>Topics tab</div> }));
vi.mock('./SignalsTab', () => ({ default: () => <div>Signals tab</div> }));
vi.mock('./SourcesTab', () => ({ default: () => <div>Sources tab</div> }));
vi.mock('./RunsTab', () => ({ default: () => <div>Runs tab</div> }));
vi.mock('./TopicDrawer', () => ({ default: () => null }));
vi.mock('./RunOptionsModal', () => ({ default: () => null }));

const plans = [
  {
    id: 11,
    account: 3,
    week_start: '2026-11-14',
    week_end: '2026-11-20',
    status: 'closed' as const,
    title: '',
  },
  {
    id: 12,
    account: 3,
    week_start: '2026-11-21',
    week_end: '2026-11-27',
    status: 'active' as const,
    title: '',
  },
  {
    id: 13,
    account: 3,
    week_start: '2026-11-28',
    week_end: '2026-12-04',
    status: 'draft' as const,
    title: '',
  },
];

describe('Research page header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nav.params = new URLSearchParams('tab=topics&plan=12');
    vi.mocked(listPlans).mockResolvedValue({
      count: 3,
      next: null,
      previous: null,
      results: plans,
    });
    vi.mocked(listJobs).mockResolvedValue({
      count: 0,
      next: null,
      previous: null,
      results: [],
    });
  });

  it('warns and opens the Sources tab on 400 no_active_sources', async () => {
    const warning = vi.spyOn(message, 'warning');
    vi.mocked(startRun).mockRejectedValue(
      apiError(400, {
        code: 'validation_error',
        fields: [
          { path: 'source_ids', code: 'no_active_sources', message: '' },
        ],
      }),
    );
    const screen = await render(withQueryClient(<ResearchPage />));
    await screen.getByRole('button', { name: 'Run research' }).click();
    await vi.waitFor(() =>
      expect(warning).toHaveBeenCalledWith(
        'Add at least one active source first',
      ),
    );
    expect(startRun).toHaveBeenCalledWith({ account: 3, plan: 12 });
    const [next] = nav.setParams.mock.calls.at(-1) as [URLSearchParams];
    expect(next.get('tab')).toBe('sources');
  });

  it('adopts the running job on 409 job_in_progress and shows its progress', async () => {
    const job = {
      id: 'job-9',
      kind: 'research.run',
      status: 'running' as const,
      progress: 30,
      message: 'Collecting Coffee trends (2 of 5)',
    };
    vi.mocked(getJob).mockResolvedValue({
      ...job,
      account: 3,
      queue: 'default',
      target_type: 'research_run',
      target_id: '31',
      result: null,
      error_code: null,
      error_detail: null,
      created_by: null,
      request_id: null,
      created_at: '2026-11-22T09:20:00Z',
      started_at: '2026-11-22T09:20:01Z',
      finished_at: null,
    });
    vi.mocked(startRun).mockRejectedValue(
      apiError(409, { code: 'job_in_progress', details: { job } }),
    );
    const screen = await render(withQueryClient(<ResearchPage />));
    await screen.getByRole('button', { name: 'Run research' }).click();
    await expect
      .element(screen.getByText('Collecting Coffee trends (2 of 5)').first())
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole('button', { name: /Collecting Coffee trends/ }))
      .toBeDisabled();
  });

  it('picks the earliest open plan whose week has not ended, in the account timezone', async () => {
    const { default: dayjs } = await import('dayjs');
    // 2026-11-27 21:00 UTC is already 28 Nov in Tehran, so week 12 is over there.
    expect(
      defaultPlanId(plans, 'Asia/Tehran', dayjs('2026-11-27T21:00:00Z')),
    ).toBe(13);
    expect(defaultPlanId(plans, 'UTC', dayjs('2026-11-27T21:00:00Z'))).toBe(12);
    expect(
      defaultPlanId([plans[0]], 'UTC', dayjs('2026-11-27T21:00:00Z')),
    ).toBe('none');
  });
});
