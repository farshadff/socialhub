import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { createSource } from '@/services/socialhub/research';
import SourceFormModal from './SourceFormModal';
import { ACCOUNT, apiError, modelFor, withQueryClient } from './testUtils';

vi.mock('@umijs/max', () => ({ useModel: (name: string) => modelFor(name) }));
vi.mock('@/services/socialhub/research', () => ({
  createSource: vi.fn(),
  updateSource: vi.fn(),
}));

function renderModal() {
  return render(
    withQueryClient(
      <SourceFormModal
        open
        account={ACCOUNT}
        source={null}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    ),
  );
}

describe('Add source', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a query shorter than 3 characters before sending', async () => {
    const screen = await renderModal();
    await screen.getByLabelText('Search query').fill('ab');
    await screen.getByRole('button', { name: 'Save' }).click();
    await expect
      .element(screen.getByText('Use at least 3 characters.'))
      .toBeInTheDocument();
    expect(createSource).not.toHaveBeenCalled();
  });

  it('sends a normalized value and shows the limit message from the server', async () => {
    vi.mocked(createSource).mockRejectedValue(
      apiError(400, {
        code: 'validation_error',
        fields: [{ path: 'active', code: 'limit_reached', message: '' }],
      }),
    );
    const screen = await renderModal();
    await screen
      .getByLabelText('Search query')
      .fill('  specialty   coffee trends ');
    await screen.getByRole('button', { name: 'Save' }).click();
    await expect
      .element(
        screen.getByText(
          'You can have at most 8 active web search sources. Deactivate one first.',
        ),
      )
      .toBeInTheDocument();
    expect(createSource).toHaveBeenCalledWith({
      account: 3,
      kind: 'web_search',
      value: 'specialty coffee trends',
      label: '',
      active: true,
    });
  });
});
