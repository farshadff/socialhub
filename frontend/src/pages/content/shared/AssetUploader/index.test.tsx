import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import {
  apiError,
  asset,
} from '@/pages/content/workspace/tabs/production/testFixtures';
import { uploadAsset } from '@/services/socialhub/assets';
import AssetUploader from './index';

vi.mock('@/services/socialhub/assets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/assets')>()),
  uploadAsset: vi.fn(),
}));

const jpeg = () =>
  new File([new Uint8Array(2048)], 'rooftop.jpg', { type: 'image/jpeg' });

async function addFiles(...files: File[]) {
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  await userEvent.upload(input, files);
}

describe('AssetUploader', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uploads with the shared rights form and reports each file', async () => {
    const uploaded = asset({ id: 400, original_filename: 'rooftop.jpg' });
    vi.mocked(uploadAsset).mockImplementation(
      async (_file, _fields, onProgress) => {
        onProgress?.(100);
        return uploaded;
      },
    );
    const onClose = vi.fn();
    await render(
      <AssetUploader
        open
        accountId={3}
        defaultRole="background"
        onClose={onClose}
      />,
    );
    await addFiles(jpeg());
    await expect.element(page.getByText('Ready to upload')).toBeInTheDocument();

    await page.getByLabelText('We may use this on Instagram').click();
    await page.getByLabelText('Licence note').fill('Shot in-house');
    await page.getByRole('button', { name: 'Upload', exact: true }).click();

    await expect.element(page.getByText('Uploaded')).toBeInTheDocument();
    expect(uploadAsset).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({
        account: 3,
        role: 'background',
        origin: 'uploaded',
        rights_status: 'cleared',
        license_note: 'Shot in-house',
      }),
      expect.any(Function),
      expect.any(AbortSignal),
    );
    await page.getByRole('button', { name: 'Done' }).click();
    expect(onClose).toHaveBeenCalledWith([uploaded]);
  });

  it('asks for a licence note when "We may use this" is checked', async () => {
    await render(<AssetUploader open accountId={3} onClose={vi.fn()} />);
    await addFiles(jpeg());
    await page.getByLabelText('We may use this on Instagram').click();
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect
      .element(
        page.getByText(
          'Add a licence note of at least 3 characters, for example "Shot in-house".',
        ),
      )
      .toBeInTheDocument();
    expect(uploadAsset).not.toHaveBeenCalled();
  });

  it('rejects an unsupported file before sending anything', async () => {
    await render(<AssetUploader open accountId={3} onClose={vi.fn()} />);
    await addFiles(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    await expect
      .element(
        page.getByText(
          'This file type is not supported. Use JPG, PNG, WebP, MP4, MOV, MP3, M4A, WAV or PDF.',
        ),
      )
      .toBeInTheDocument();
    await expect
      .element(page.getByRole('button', { name: 'Upload', exact: true }))
      .toBeDisabled();
    expect(uploadAsset).not.toHaveBeenCalled();
  });

  it('rejects a file whose kind does not fit the role', async () => {
    await render(
      <AssetUploader
        open
        accountId={3}
        defaultRole="music"
        onClose={vi.fn()}
      />,
    );
    await addFiles(jpeg());
    await expect
      .element(page.getByText("Image files can't be used as music."))
      .toBeInTheDocument();
  });

  it('shows the server reasons in plain words and continues with the next file', async () => {
    vi.mocked(uploadAsset)
      .mockRejectedValueOnce(
        apiError(400, {
          code: 'unsupported_media',
          details: { reasons: ['duration_too_long: 742 s, max 600 s'] },
        }),
      )
      .mockResolvedValueOnce(asset({ id: 401, duplicate: true }));
    await render(<AssetUploader open accountId={3} onClose={vi.fn()} />);
    await addFiles(
      new File([new Uint8Array(4096)], 'long.mp4', { type: 'video/mp4' }),
      jpeg(),
    );
    await page.getByRole('button', { name: 'Upload 2 files' }).click();
    await expect
      .element(page.getByText('The file is too long (742 s, max 600 s).'))
      .toBeInTheDocument();
    await expect
      .element(page.getByText('Already in the library'))
      .toBeInTheDocument();
    expect(uploadAsset).toHaveBeenCalledTimes(2);
  });
});
