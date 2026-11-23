import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { ApiError } from '@/services/socialhub/http';
import {
  confirmSelection,
  type Proposal,
} from '@/services/socialhub/selection';
import ProposalTab from './ProposalTab';
import { ACCOUNT, apiError, modelFor, withQueryClient } from './testUtils';

vi.mock('@umijs/max', () => ({
  useModel: (name: string) => modelFor(name),
  Link: ({ children }: any) => children,
  history: { push: vi.fn() },
}));
vi.mock('@/services/socialhub/selection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/selection')>()),
  confirmSelection: vi.fn(),
}));

const slot = (id: number, at: string, format: any, role: any) => ({
  id,
  scheduled_at: at,
  format,
  role,
  status: 'open' as const,
});

const PROPOSAL: Proposal = {
  plan: {
    id: 12,
    status: 'active',
    week_start: '2026-11-28',
    week_end: '2026-12-04',
  },
  ranked_at: '2026-11-22T09:14:31Z',
  autopilot: false,
  assignments: [
    {
      slot: slot(101, '2099-11-28T15:30:00Z', 'reel', 'educate'),
      candidate: {
        id: 540,
        kind: 'trend',
        title: 'Five-minute desk setup',
        rank: 1,
        total_score: '77.80',
        suggested_formats: ['reel', 'story'],
        suggested_role: 'educate',
        duplicate_of: null,
      },
      fit: {
        format_points: 3,
        role_points: 2,
        format_match: true,
        role_match: true,
      },
    },
  ],
  unfilled_slots: [slot(102, '2099-11-29T08:30:00Z', 'story', 'engage')],
  unassigned_candidates: [],
  reserved_slots: [],
  warnings: [],
};

const PLAN = {
  id: 12,
  account: 3,
  week_start: '2026-11-28',
  week_end: '2026-12-04',
  status: 'active' as const,
  title: '',
};

function renderTab(
  overrides: Partial<React.ComponentProps<typeof ProposalTab>> = {},
) {
  return render(
    withQueryClient(
      <ProposalTab
        account={ACCOUNT}
        plan={PLAN}
        refreshKey={0}
        rankRunning={false}
        onChanged={vi.fn()}
        goToTab={vi.fn()}
        proposal={PROPOSAL}
        loading={false}
        error={null}
        reloadProposal={vi.fn()}
        onRank={vi.fn()}
        {...overrides}
      />,
    ),
  );
}

describe('Proposal tab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the fill count and the fit of the proposed pair', async () => {
    const screen = await renderTab();
    await expect
      .element(screen.getByText('1 of 2 open slots filled'))
      .toBeInTheDocument();
    await expect.element(screen.getByText('Format match')).toBeInTheDocument();
    await expect.element(screen.getByText('Role match')).toBeInTheDocument();
  });

  it('disables Confirm for a draft plan', async () => {
    const screen = await renderTab({ plan: { ...PLAN, status: 'draft' } });
    await expect
      .element(screen.getByRole('button', { name: 'Confirm selection (1)' }))
      .toBeDisabled();
  });

  it('reuses the idempotency key when a failed request is retried', async () => {
    vi.mocked(confirmSelection)
      .mockRejectedValueOnce(
        new ApiError(0, { code: 'network_error', message: 'offline' }),
      )
      .mockResolvedValueOnce({
        plan: 12,
        created: [],
        open_slots_remaining: 1,
      });
    const screen = await renderTab();
    await screen.getByRole('button', { name: 'Confirm selection (1)' }).click();
    await page.getByRole('button', { name: 'Create items' }).click();
    await vi.waitFor(() => expect(confirmSelection).toHaveBeenCalledTimes(1));
    await screen.getByRole('button', { name: 'Confirm selection (1)' }).click();
    await page.getByRole('button', { name: 'Create items' }).click();
    await vi.waitFor(() => expect(confirmSelection).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(confirmSelection).mock.calls;
    expect(first[0]).toEqual({
      plan: 12,
      assignments: [{ candidate: 540, slot: 101 }],
    });
    expect(second[1]).toBe(first[1]);
  });

  it('shows confirm field errors under the affected row', async () => {
    vi.mocked(confirmSelection).mockRejectedValue(
      apiError(400, {
        code: 'validation_error',
        fields: [
          { path: 'assignments.0.slot', code: 'slot_not_open', message: '' },
        ],
      }),
    );
    const screen = await renderTab();
    await screen.getByRole('button', { name: 'Confirm selection (1)' }).click();
    await page.getByRole('button', { name: 'Create items' }).click();
    await expect
      .element(screen.getByText('This slot is no longer open'))
      .toBeInTheDocument();
  });
});
