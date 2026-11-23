import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import {
  asset,
  modelFor,
  page as pageOf,
  withQueryClient,
} from '@/pages/content/workspace/tabs/production/testFixtures';
import { deleteAsset, getAsset, listAssets } from '@/services/socialhub/assets';
import AssetDrawer, { usedInText } from './AssetDrawer';
import LibraryPage, { DEFAULT_FILTERS, toListParams } from './index';

vi.mock('@umijs/max', () => ({
  useModel: (name: string) => modelFor(name),
  Link: ({ to, children }: any) => <a href={to}>{children}</a>,
  history: {},
}));
vi.mock('@ant-design/pro-components', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ant-design/pro-components')>()),
  PageContainer: ({ title, content, extra, children }: any) => (
    <div>
      <h1>{title}</h1>
      <p>{content}</p>
      {extra}
      {children}
    </div>
  ),
}));
vi.mock('@/services/socialhub/assets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/assets')>()),
  listAssets: vi.fn(),
  getAsset: vi.fn(),
  deleteAsset: vi.fn(),
  updateAsset: vi.fn(),
}));

describe('Library page', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the empty state with Upload when the library has no assets', async () => {
    vi.mocked(listAssets).mockResolvedValue(pageOf([]));
    const screen = await render(withQueryClient(<LibraryPage />));
    await expect
      .element(
        screen.getByText(
          'No assets yet. Upload images, clips or music to use in production.',
        ),
      )
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByText(
          'Images, clips and music for this account, with their usage rights.',
        ),
      )
      .toBeInTheDocument();
    expect(listAssets).toHaveBeenCalledWith(
      expect.objectContaining({ account: 3, content_item: 'null' }),
    );
  });

  it('offers Clear filters when nothing matches', async () => {
    vi.mocked(listAssets).mockResolvedValue(pageOf([]));
    const screen = await render(withQueryClient(<LibraryPage />));
    await screen.getByRole('radio', { name: 'Images' }).click();
    await expect
      .element(screen.getByText('Nothing matches these filters.'))
      .toBeInTheDocument();
    await screen.getByRole('button', { name: 'Clear filters' }).click();
    await expect
      .element(
        screen.getByText(
          'No assets yet. Upload images, clips or music to use in production.',
        ),
      )
      .toBeInTheDocument();
  });

  it('shows cards with rights and the in-use tag', async () => {
    vi.mocked(listAssets).mockResolvedValue(
      pageOf([
        asset({
          id: 9,
          original_filename: 'calm-loop.m4a',
          kind: 'audio',
          duration_ms: 92000,
          in_use: true,
        }),
      ]),
    );
    const screen = await render(withQueryClient(<LibraryPage />));
    await expect
      .element(screen.getByRole('button', { name: 'Open calm-loop.m4a' }))
      .toBeInTheDocument();
    await expect.element(screen.getByText('1 min 32 s')).toBeInTheDocument();
    await expect.element(screen.getByText('In use')).toBeInTheDocument();
    await expect.element(screen.getByText('Cleared')).toBeInTheDocument();
  });

  it('maps the scope filter to the API query', () => {
    expect(toListParams(3, DEFAULT_FILTERS, 1, 24)).toMatchObject({
      content_item: 'null',
      in_use: undefined,
    });
    expect(
      toListParams(3, { ...DEFAULT_FILTERS, scope: 'used' }, 1, 24),
    ).toMatchObject({
      content_item: undefined,
      in_use: true,
    });
    expect(
      toListParams(
        3,
        { ...DEFAULT_FILTERS, rights: 'expired', kind: 'video' },
        2,
        24,
      ),
    ).toMatchObject({
      rights_status: ['expired'],
      kind: 'video',
      page: 2,
    });
  });
});

describe('Asset drawer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('disables Delete with the usage count when the asset is in use', async () => {
    vi.mocked(getAsset).mockResolvedValue({
      ...asset({
        id: 318,
        original_filename: 'calm-loop.m4a',
        kind: 'audio',
        in_use: true,
      }),
      used_by: [
        {
          content_item: 42,
          title: 'Three signs your budget is leaking',
          version: 1,
          as: 'music_asset',
        },
        {
          content_item: 42,
          title: 'Three signs your budget is leaking',
          version: 2,
          as: 'music_asset',
        },
        { content_item: 57, title: 'Unboxing', version: 1, as: 'music_asset' },
      ],
    });
    await render(
      withQueryClient(
        <AssetDrawer
          accountId={3}
          assetId={318}
          onClose={vi.fn()}
          onChanged={vi.fn()}
        />,
      ),
    );
    const remove = page.getByRole('button', { name: 'Delete' });
    await expect.element(remove).toBeDisabled();
    await expect
      .element(page.getByRole('link', { name: 'Unboxing' }))
      .toHaveAttribute('href', '/content/57');
    await expect
      .element(page.getByText('Version 2 · Music'))
      .toBeInTheDocument();
    expect(usedInText(2)).toBe('Used in 2 items');
    expect(usedInText(1)).toBe('Used in 1 item');
    expect(deleteAsset).not.toHaveBeenCalled();
  });

  it('deletes an unused asset after naming it in the confirmation', async () => {
    vi.mocked(getAsset).mockResolvedValue({
      ...asset({ id: 311 }),
      used_by: [],
    });
    vi.mocked(deleteAsset).mockResolvedValue(undefined);
    const onChanged = vi.fn();
    const onClose = vi.fn();
    await render(
      withQueryClient(
        <AssetDrawer
          accountId={3}
          assetId={311}
          onClose={onClose}
          onChanged={onChanged}
        />,
      ),
    );
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect
      .element(
        page.getByText('Delete Rooftop Sunset.JPG? This cannot be undone.'),
      )
      .toBeInTheDocument();
    await page
      .getByRole('button', { name: 'Delete', exact: true })
      .last()
      .click();
    await vi.waitFor(() => expect(deleteAsset).toHaveBeenCalledWith(311));
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});
