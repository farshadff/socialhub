import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { generateScript } from '@/services/socialhub/scripts';
import RegenerateScriptModal from './RegenerateScriptModal';
import { apiError, job, modelFor, withQueryClient } from './testUtils';

vi.mock('@umijs/max', () => ({ useModel: (name: string) => modelFor(name), history: {} }));
vi.mock('@/services/socialhub/scripts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/scripts')>()),
  generateScript: vi.fn(),
}));

async function renderModal(overrides: { dirty?: boolean } = {}) {
  const handlers = { onStarted: vi.fn(), onReload: vi.fn(), onSaveNow: vi.fn(), onOpenChange: vi.fn() };
  const screen = await render(
    withQueryClient(
      <RegenerateScriptModal
        open
        itemId={42}
        version={2}
        dirty={overrides.dirty ?? false}
        {...handlers}
      />,
    ),
  );
  return { screen, ...handlers };
}

const submit = () => page.getByRole('button', { name: 'Regenerate' });

describe('Regenerate script', () => {
  beforeEach(() => vi.clearAllMocks());

  it('enables Regenerate only with direction or "Start over"', async () => {
    await renderModal();
    await expect
      .element(
        page.getByText(
          'The AI rewrites version 2 using your direction. The current version is kept in history.',
        ),
      )
      .toBeVisible();
    await expect.element(submit()).toBeDisabled();
    await page.getByLabelText('What should change?').fill('Open with a question');
    await expect.element(submit()).toBeEnabled();
    await page.getByLabelText('What should change?').fill('   ');
    await expect.element(submit()).toBeDisabled();
    await page.getByText('Start over from the brief (ignore the current script)').click();
    await expect.element(submit()).toBeEnabled();
    await expect
      .element(page.getByText('The new script will not be based on version 2.'))
      .toBeVisible();
  });

  it('sends the feedback with the base version and reports the job', async () => {
    const started = job({ status: 'queued', progress: 0 });
    vi.mocked(generateScript).mockResolvedValue({ job: started });
    const { onStarted } = await renderModal();
    await page.getByLabelText('What should change?').fill('Open with a question');
    await submit().click();
    await vi.waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(generateScript).toHaveBeenCalledWith(42, {
      feedback: 'Open with a question',
      base_version: 2,
    });
    expect(onStarted.mock.calls[0][0]).toEqual(started);
  });

  it('sends start_over with the latest base version when starting over', async () => {
    vi.mocked(generateScript).mockResolvedValue({ job: job({ status: 'queued', progress: 0 }) });
    const { onStarted } = await renderModal();
    await page.getByText('Start over from the brief (ignore the current script)').click();
    await submit().click();
    await vi.waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(generateScript).toHaveBeenCalledWith(42, { start_over: true, base_version: 2 });
  });

  it('shows the conflict message with a Reload button on 409 version_conflict', async () => {
    vi.mocked(generateScript).mockRejectedValue(
      apiError(409, { code: 'version_conflict', details: { latest_version: 3 } }),
    );
    const { onReload, onStarted } = await renderModal();
    await page.getByLabelText('What should change?').fill('Shorter');
    await submit().click();
    await expect
      .element(page.getByText('Someone saved a newer version. Reload and try again.'))
      .toBeVisible();
    await page.getByRole('button', { name: 'Reload' }).click();
    expect(onReload).toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
  });

  it('warns about unsaved changes and offers to save them', async () => {
    const { onSaveNow } = await renderModal({ dirty: true });
    await expect
      .element(
        page.getByText(
          'You have unsaved changes. Save them first, or they will not be part of the rewrite.',
        ),
      )
      .toBeVisible();
    await page.getByRole('button', { name: 'Save now' }).click();
    expect(onSaveNow).toHaveBeenCalled();
  });
});
