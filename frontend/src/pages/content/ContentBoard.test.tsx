import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import type { ContentItemSummary } from '@/services/socialhub/content';
import { modelFor, withQueryClient } from '../selection/testUtils';
import ContentBoard from './ContentBoard';

vi.mock('@umijs/max', () => ({
  useModel: (name: string) => modelFor(name),
  history: { push: vi.fn() },
}));
vi.mock('@/pages/content/shared/useFormats', () => ({
  default: () => ({
    formatLabel: (f: string) => f,
    roleLabel: (r: string) => r ?? 'Not set',
  }),
}));

const item = (
  id: number,
  title: string,
  status: ContentItemSummary['status'],
): ContentItemSummary => ({
  id,
  account: 3,
  title,
  format: 'reel',
  media_kind: 'video',
  production_mode: 'motion',
  role: null,
  status,
  hold_reason: '',
  needs_attention: status === 'in_review',
  revision_count: 0,
  plan: null,
  slot: null,
  candidate: null,
  active_job: null,
  thumbnail_url: null,
  publication: null,
  created_at: '2026-11-22T09:20:11Z',
  updated_at: '2026-11-22T09:20:11Z',
});

describe('Content board', () => {
  it('shows in_check and in_review in the In check column with their own tags', async () => {
    const screen = await render(
      withQueryClient(
        <ContentBoard
          items={[
            item(1, 'Lamp reel', 'in_check'),
            item(2, 'Poll story', 'in_review'),
          ]}
          total={2}
          statusFilter={[]}
        />,
      ),
    );
    const column = screen.getByRole('region', { name: 'In check, 2 items' });
    await expect.element(column).toBeInTheDocument();
    await expect.element(column.getByText('Lamp reel')).toBeInTheDocument();
    await expect.element(column.getByText('In review')).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Cancelled, 0 items' }).query(),
    ).toBeNull();
  });

  it('tells the user when only the first 100 items are shown', async () => {
    const screen = await render(
      withQueryClient(
        <ContentBoard items={[]} total={140} statusFilter={[]} />,
      ),
    );
    await expect
      .element(
        screen.getByText('Showing the first 100 items — narrow the filters'),
      )
      .toBeInTheDocument();
  });
});
