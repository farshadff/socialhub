import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import {
  asset,
  page as pageOf,
  withQueryClient,
} from '@/pages/content/workspace/tabs/production/testFixtures';
import { listAssets } from '@/services/socialhub/assets';
import AssetPicker from './index';

vi.mock('@/services/socialhub/assets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/assets')>()),
  listAssets: vi.fn(),
}));

function renderPicker(onSelect = vi.fn(), onClose = vi.fn()) {
  return render(
    withQueryClient(
      <AssetPicker
        open
        accountId={3}
        kind="image"
        uploadRole="background"
        contentItemId={42}
        onSelect={onSelect}
        onClose={onClose}
      />,
    ),
  );
}

describe('AssetPicker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists this item first, then the library, and selects a cleared asset at once', async () => {
    vi.mocked(listAssets).mockImplementation(async (params) =>
      params.content_item === 42
        ? pageOf([
            asset({
              id: 1,
              original_filename: 'item-photo.jpg',
              content_item: 42,
            }),
          ])
        : pageOf([asset({ id: 2, original_filename: 'library-photo.jpg' })]),
    );
    const onSelect = vi.fn();
    const onClose = vi.fn();
    await renderPicker(onSelect, onClose);
    await expect
      .element(page.getByRole('button', { name: 'Choose item-photo.jpg' }))
      .toBeInTheDocument();
    expect(listAssets).toHaveBeenCalledWith(
      expect.objectContaining({ account: 3, kind: 'image', content_item: 42 }),
    );

    await page.getByRole('tab', { name: 'Library' }).click();
    await page
      .getByRole('button', { name: 'Choose library-photo.jpg' })
      .click();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
    expect(onClose).toHaveBeenCalled();
    expect(listAssets).toHaveBeenCalledWith(
      expect.objectContaining({ content_item: 'null' }),
    );
  });

  it('confirms before picking an asset with restricted rights', async () => {
    vi.mocked(listAssets).mockResolvedValue(
      pageOf([
        asset({
          id: 5,
          original_filename: 'press-photo.jpg',
          rights_status: 'restricted',
        }),
      ]),
    );
    const onSelect = vi.fn();
    await renderPicker(onSelect);
    await page.getByRole('button', { name: 'Choose press-photo.jpg' }).click();
    await expect
      .element(
        page.getByText(
          "This asset's rights are restricted. The rights check will fail unless you fix them.",
        ),
      )
      .toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'Use this asset' }).click();
    await vi.waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 5 })),
    );
  });

  it('does not pick when the rights warning is cancelled', async () => {
    vi.mocked(listAssets).mockResolvedValue(
      pageOf([
        asset({
          id: 6,
          original_filename: 'old.jpg',
          rights_status: 'expired',
        }),
      ]),
    );
    const onSelect = vi.fn();
    await renderPicker(onSelect);
    await page.getByRole('button', { name: 'Choose old.jpg' }).click();
    await page.getByRole('button', { name: 'Choose another' }).click();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
