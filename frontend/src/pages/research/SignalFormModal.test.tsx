import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { createSignal, listTopics } from '@/services/socialhub/research';
import SignalFormModal from './SignalFormModal';
import { ACCOUNT, apiError, modelFor, withQueryClient } from './testUtils';

vi.mock('@umijs/max', () => ({ useModel: (name: string) => modelFor(name) }));
vi.mock('@/services/socialhub/research', () => ({
  createSignal: vi.fn(),
  listTopics: vi.fn(),
}));

describe('Add signal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listTopics).mockResolvedValue({
      count: 0,
      next: null,
      previous: null,
      results: [],
    });
  });

  it('explains a duplicate link and "Show it" filters to the existing signal', async () => {
    vi.mocked(createSignal).mockRejectedValue(
      apiError(400, {
        code: 'validation_error',
        fields: [{ path: 'url', code: 'unique', message: '' }],
        details: { signal_id: 412 },
      }),
    );
    const onShowExisting = vi.fn();
    const onOpenChange = vi.fn();
    const screen = await render(
      withQueryClient(
        <SignalFormModal
          open
          account={ACCOUNT}
          onOpenChange={onOpenChange}
          onCreated={vi.fn()}
          onShowExisting={onShowExisting}
        />,
      ),
    );
    await screen
      .getByLabelText('Link')
      .fill('https://instagram.com/p/DCx1abcDEF/');
    await screen.getByLabelText('Title').fill('Competitor reel on cold brew');
    await screen.getByRole('button', { name: 'Save' }).click();

    await expect
      .element(screen.getByText('This link is already saved as a signal.'))
      .toBeInTheDocument();
    expect(createSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        account: 3,
        url: 'https://instagram.com/p/DCx1abcDEF/',
        title: 'Competitor reel on cold brew',
      }),
    );
    await screen.getByRole('button', { name: 'Show it' }).click();
    expect(onShowExisting).toHaveBeenCalledWith(412);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('requires "What it shows" when there is no link', async () => {
    const screen = await render(
      withQueryClient(
        <SignalFormModal
          open
          account={ACCOUNT}
          onOpenChange={vi.fn()}
          onCreated={vi.fn()}
          onShowExisting={vi.fn()}
        />,
      ),
    );
    await screen.getByLabelText('Title').fill('Something seen at a café');
    await screen.getByRole('button', { name: 'Save' }).click();
    await expect
      .element(screen.getByText('Describe what it shows, or add a link.'))
      .toBeInTheDocument();
    expect(createSignal).not.toHaveBeenCalled();
  });
});
