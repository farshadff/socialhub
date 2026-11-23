import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { createFeedSource } from '@/services/socialhub/feeds';
import FeedSourceFormModal from './FeedSourceFormModal';
import { ACCOUNT, apiError, modelFor, withQueryClient } from './testUtils';

vi.mock('@umijs/max', () => ({ useModel: (name: string) => modelFor(name) }));
vi.mock('@/services/socialhub/feeds', () => ({
  createFeedSource: vi.fn(),
  updateFeedSource: vi.fn(),
}));

const onSaved = vi.fn();

function renderModal() {
  return render(
    withQueryClient(
      <FeedSourceFormModal
        open
        account={ACCOUNT}
        source={null}
        onOpenChange={vi.fn()}
        onSaved={onSaved}
      />,
    ),
  );
}

describe('Add feed source', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the field mapping only for a JSON endpoint', async () => {
    const screen = await renderModal();
    expect(screen.getByLabelText('Items path').query()).toBeNull();
    await screen.getByText('JSON endpoint').click();
    await expect
      .element(screen.getByLabelText('Items path'))
      .toBeInTheDocument();
    await expect
      .element(screen.getByLabelText('Auth header variable'))
      .toBeInTheDocument();
    await screen.getByText('RSS or Atom feed').click();
    expect(screen.getByLabelText('Items path').query()).toBeNull();
  });

  it('requires the ID and title paths for a JSON endpoint', async () => {
    const screen = await renderModal();
    await screen.getByText('JSON endpoint').click();
    await screen.getByLabelText('Name').fill('Product catalogue');
    await screen
      .getByLabelText('Link')
      .fill('https://api.example.com/v1/products');
    await screen.getByRole('button', { name: 'Save' }).click();
    await expect
      .element(screen.getByText('Enter the path to the id.'))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText('Enter the path to the title.'))
      .toBeInTheDocument();
    expect(createFeedSource).not.toHaveBeenCalled();
  });

  it('sends the nested config and shows a server field error under its field', async () => {
    vi.mocked(createFeedSource).mockRejectedValue(
      apiError(400, {
        code: 'validation_error',
        fields: [{ path: 'name', code: 'unique', message: '' }],
      }),
    );
    const screen = await renderModal();
    await screen.getByText('JSON endpoint').click();
    await screen.getByLabelText('Name').fill('Product catalogue');
    await screen
      .getByLabelText('Link')
      .fill('https://api.example.com/v1/products');
    await screen.getByLabelText('Items path').fill('data.items');
    await screen.getByLabelText('ID').fill('id');
    await screen.getByLabelText('Title').fill('name');
    await screen.getByLabelText('Image link').fill('images.0.url');
    await screen
      .getByLabelText('Auth header variable')
      .fill('SOCIALHUB_FEED_CATALOGUE_AUTH');
    await screen.getByRole('button', { name: 'Save' }).click();
    await expect
      .element(screen.getByText('Another source already uses this name.'))
      .toBeInTheDocument();
    expect(createFeedSource).toHaveBeenCalledWith({
      account: 3,
      kind: 'json_api',
      active: true,
      name: 'Product catalogue',
      url: 'https://api.example.com/v1/products',
      config: {
        auto_eligible: true,
        max_age_days: 14,
        items_path: 'data.items',
        fields: { external_id: 'id', title: 'name', image_url: 'images.0.url' },
        auth_header_env: 'SOCIALHUB_FEED_CATALOGUE_AUTH',
      },
    });
    expect(onSaved).not.toHaveBeenCalled();
  });
});
