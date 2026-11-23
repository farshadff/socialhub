import { message } from 'antd';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { getBrief } from '@/services/socialhub/briefs';
import type { ContentItemDetail } from '@/services/socialhub/content';
import { getFormats } from '@/services/socialhub/formats';
import { getJob } from '@/services/socialhub/jobs';
import {
  approveScript,
  generateScript,
  getScript,
  getScriptVersion,
  listScriptVersions,
  saveScript,
  type ScriptVersionEntry,
} from '@/services/socialhub/scripts';
import ScriptTab from './index';
import {
  contentItem,
  feedPostPackage,
  formatsResponse,
  reelMotionPackage,
  scriptResource,
} from './testFixtures';
import { apiError, job, modelFor, noScript, withQueryClient } from './testUtils';

vi.mock('@umijs/max', () => ({
  useModel: (name: string) => modelFor(name),
  history: {},
}));
vi.mock('@/services/socialhub/scripts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/scripts')>()),
  getScript: vi.fn(),
  generateScript: vi.fn(),
  saveScript: vi.fn(),
  approveScript: vi.fn(),
  listScriptVersions: vi.fn(),
  getScriptVersion: vi.fn(),
}));
vi.mock('@/services/socialhub/formats', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/formats')>()),
  getFormats: vi.fn(),
}));
vi.mock('@/services/socialhub/briefs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/briefs')>()),
  getBrief: vi.fn(),
}));
vi.mock('@/services/socialhub/jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/jobs')>()),
  getJob: vi.fn(),
}));

const props = (item: ContentItemDetail) => ({
  item,
  reload: vi.fn(),
  switchTab: vi.fn(),
  openFormatModal: vi.fn(),
});

async function renderTab(item: ContentItemDetail = contentItem()) {
  const p = props(item);
  const screen = await render(withQueryClient(<ScriptTab {...p} />));
  return { ...p, screen };
}

const dialog = () => page.getByRole('dialog');

describe('Script tab: states without a script', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFormats).mockResolvedValue(formatsResponse);
    vi.mocked(getBrief).mockResolvedValue({ brief: { cta: 'Save the checklist' } } as never);
    vi.mocked(getScript).mockRejectedValue(noScript());
  });

  it('sends the operator to the brief while it is not approved', async () => {
    const item = contentItem({
      status: 'selected',
      current_brief: { ...(contentItem().current_brief as NonNullable<ContentItemDetail['current_brief']>), status: 'draft' },
    });
    const { screen, switchTab } = await renderTab(item);
    await expect
      .element(screen.getByText('The script is written from the approved brief.'))
      .toBeVisible();
    await screen.getByRole('button', { name: 'Go to brief' }).click();
    expect(switchTab).toHaveBeenCalledWith('brief');
  });

  it('offers to generate or write by hand when the brief is approved', async () => {
    const { screen } = await renderTab();
    await expect
      .element(screen.getByText('No script yet. Generate one from the brief.'))
      .toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Generate script' })).toBeEnabled();
    await expect.element(screen.getByRole('button', { name: 'Write script by hand' })).toBeEnabled();
  });

  it('shows the running script job with its message', async () => {
    vi.mocked(getJob).mockResolvedValue(job());
    const item = contentItem({
      active_job: {
        id: 'job-1',
        kind: 'script.generate',
        status: 'running',
        progress: 30,
        message: 'Writing the script',
      },
    });
    const { screen } = await renderTab(item);
    await expect.element(screen.getByText('Writing the script')).toBeVisible();
    await expect
      .element(screen.getByRole('button', { name: 'Generate script' }))
      .not.toBeInTheDocument();
  });

  it('shows the E05-S01 copy when the job fails', async () => {
    vi.mocked(generateScript).mockResolvedValue({ job: job({ status: 'queued', progress: 0 }) });
    vi.mocked(getJob).mockResolvedValue(
      job({ status: 'failed', error_code: 'provider_error', error_detail: 'refused' }),
    );
    const { screen } = await renderTab();
    await screen.getByRole('button', { name: 'Generate script' }).click();
    await expect
      .element(
        screen.getByText(
          'The AI service declined this request. Edit the brief or write the script by hand.',
        ),
      )
      .toBeVisible();
    await expect.element(screen.getByText('Reference: req-job')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it('shows the provider warning on 503 provider_not_configured', async () => {
    vi.mocked(generateScript).mockRejectedValue(apiError(503, { code: 'provider_not_configured' }));
    const { screen } = await renderTab();
    await screen.getByRole('button', { name: 'Generate script' }).click();
    await expect
      .element(
        screen.getByText(
          'The AI provider is not configured. Ask an admin to check Settings → System.',
        ),
      )
      .toBeVisible();
  });

  it('writes a script by hand and saves it as version 1 with base_version 0', async () => {
    vi.mocked(saveScript).mockResolvedValue(
      scriptResource({ origin: 'human', created_by: { id: 3, name: 'Sara Ahmadi' } }),
    );
    const { screen } = await renderTab();
    await screen.getByRole('button', { name: 'Write script by hand' }).click();
    await expect.element(screen.getByText('New script')).toBeVisible();
    await expect.element(screen.getByText('Unsaved changes')).toBeVisible();
    await screen.getByLabelText('Hook').fill('Do you really need to post every day?');
    await screen.getByRole('button', { name: 'Save as new version' }).click();
    await dialog().getByRole('button', { name: 'Save' }).click();
    await vi.waitFor(() => expect(saveScript).toHaveBeenCalled());
    const [itemId, body] = vi.mocked(saveScript).mock.calls[0];
    expect(itemId).toBe(42);
    expect(body.base_version).toBe(0);
    expect(body.payload.hook).toBe('Do you really need to post every day?');
    expect(body.payload.shots).toHaveLength(4);
    expect(body.payload.frames).toHaveLength(4);
  });
});

describe('Script tab: editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFormats).mockResolvedValue(formatsResponse);
    vi.mocked(getBrief).mockResolvedValue({ brief: { cta: 'Save the checklist' } } as never);
    vi.mocked(getScript).mockResolvedValue(scriptResource());
  });

  it('shows the loaded version with header, frames and an enabled approve button', async () => {
    const { screen } = await renderTab();
    await expect.element(screen.getByText('Version 1')).toBeVisible();
    await expect.element(screen.getByText('Waiting for approval')).toBeVisible();
    await expect.element(screen.getByText('written from brief v1')).toBeVisible();
    await expect.element(screen.getByLabelText('Hook')).toHaveValue(reelMotionPackage().hook);
    await expect.element(screen.getByText('Total duration: 30 s (15–60 s)')).toBeVisible();
    expect(screen.getByLabelText(/^Frame \d preview$/).elements()).toHaveLength(5);
    await expect.element(screen.getByRole('button', { name: 'Approve script' })).toBeEnabled();
    await expect
      .element(screen.getByRole('button', { name: 'Save as new version' }))
      .toBeDisabled();
  });

  it('saves an edit as a new version and reloads from the response', async () => {
    const success = vi.spyOn(message, 'success');
    const saved = scriptResource({
      version: 2,
      latest_version: 2,
      origin: 'human',
      created_by: { id: 3, name: 'Sara Ahmadi' },
      payload: { ...reelMotionPackage(), hook: 'Do you post every day?' },
    });
    vi.mocked(saveScript).mockResolvedValue(saved);
    const { screen, reload } = await renderTab();
    await screen.getByLabelText('Hook').fill('Do you post every day?');
    await expect.element(screen.getByText('Unsaved changes')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Approve script' })).toBeDisabled();
    await screen.getByRole('button', { name: 'Save as new version' }).click();
    await dialog().getByLabelText('What changed? (optional)').fill('Shorter hook');
    await dialog().getByRole('button', { name: 'Save' }).click();
    await vi.waitFor(() => expect(success).toHaveBeenCalledWith('Saved as version 2.'));
    const [, body] = vi.mocked(saveScript).mock.calls[0];
    expect(body).toMatchObject({ base_version: 1, note: 'Shorter hook' });
    expect(body.payload.hook).toBe('Do you post every day?');
    expect(reload).toHaveBeenCalled();
    await expect.element(screen.getByText('Version 2')).toBeVisible();
    await expect.element(screen.getByText('Edited by Sara Ahmadi')).toBeVisible();
    await expect.element(screen.getByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('shows the conflict dialog on 409 and keeps the edits', async () => {
    vi.mocked(saveScript).mockRejectedValue(
      apiError(409, { code: 'version_conflict', details: { latest_version: 2 } }),
    );
    const { screen } = await renderTab();
    await screen.getByLabelText('Hook').fill('My own hook');
    await screen.getByRole('button', { name: 'Save as new version' }).click();
    await dialog().getByRole('button', { name: 'Save' }).click();
    await expect
      .element(page.getByText('Someone saved version 2 while you were editing.'))
      .toBeVisible();
    await expect
      .element(page.getByRole('button', { name: 'Reload latest (discard my changes)' }))
      .toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect.element(screen.getByLabelText('Hook')).toHaveValue('My own hook');
    await expect.element(screen.getByText('Unsaved changes')).toBeVisible();
  });

  it('puts 400 field errors under their fields', async () => {
    const error = vi.spyOn(message, 'error');
    vi.mocked(saveScript).mockRejectedValue(
      apiError(400, {
        code: 'validation_error',
        fields: [{ path: 'payload.frames.1.template', code: 'invalid_choice', message: '…' }],
      }),
    );
    const { screen } = await renderTab();
    await screen.getByLabelText('Hook').fill('Another hook');
    await screen.getByRole('button', { name: 'Save as new version' }).click();
    await dialog().getByRole('button', { name: 'Save' }).click();
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Some fields are not valid.'));
    await expect.element(screen.getByText("That choice isn't available.")).toBeVisible();
  });

  it('explains why approval is disabled', async () => {
    vi.mocked(getScript).mockResolvedValue(
      scriptResource({
        validation: {
          valid: false,
          issues: [
            { code: 'text_too_long', path: 'frames.0.headline', message: '', limit: 60, actual: 80 },
          ],
        },
        actions: { can_generate: true, can_edit: true, can_approve: false },
      }),
    );
    const { screen } = await renderTab();
    await expect
      .element(screen.getByText('1 problem must be fixed before this script can be approved.'))
      .toBeVisible();
    await expect
      .element(screen.getByText('Frame 1 headline is 80 characters; the limit is 60.'))
      .toBeVisible();
    const approve = screen.getByRole('button', { name: 'Approve script' });
    await expect.element(approve).toBeDisabled();
    await approve.hover({ force: true });
    await expect.element(page.getByText('Fix the listed problems first')).toBeVisible();
  });

  it('explains that the brief changed', async () => {
    vi.mocked(getScript).mockResolvedValue(
      scriptResource({
        brief_is_current: false,
        actions: { can_generate: true, can_edit: true, can_approve: false },
      }),
    );
    const { screen } = await renderTab();
    const approve = screen.getByRole('button', { name: 'Approve script' });
    await expect.element(approve).toBeDisabled();
    await approve.hover({ force: true });
    await expect
      .element(
        page.getByText(
          'The brief changed after this script was written. Regenerate or save a new version.',
        ),
      )
      .toBeVisible();
  });

  it('approves after confirmation and reloads the item', async () => {
    const success = vi.spyOn(message, 'success');
    vi.mocked(approveScript).mockResolvedValue({
      script: scriptResource({ status: 'approved', approved_version: 1 }),
      content_item: { id: 42, status: 'in_production', active_job: null },
    });
    const { screen, reload } = await renderTab();
    await screen.getByRole('button', { name: 'Approve script' }).click();
    await expect
      .element(page.getByText('Approve version 1? Production starts right away.'))
      .toBeVisible();
    await dialog().getByRole('button', { name: 'Approve script' }).click();
    await vi.waitFor(() =>
      expect(success).toHaveBeenCalledWith('Script approved. Production started.'),
    );
    expect(approveScript).toHaveBeenCalledWith(42, 1);
    expect(reload).toHaveBeenCalled();
  });

  it('refreshes the problems alert when approval is refused with rule problems', async () => {
    vi.mocked(approveScript).mockRejectedValue(
      apiError(400, {
        code: 'validation_error',
        fields: [{ path: 'payload.frames.2.headline', code: 'text_too_long', message: '…' }],
      }),
    );
    const { screen } = await renderTab();
    await screen.getByRole('button', { name: 'Approve script' }).click();
    await dialog().getByRole('button', { name: 'Approve script' }).click();
    await expect
      .element(screen.getByText('1 problem must be fixed before this script can be approved.'))
      .toBeVisible();
    await expect.element(screen.getByText('Frame 3 headline is too long.')).toBeVisible();
  });

  it('is read-only while the item is in check', async () => {
    vi.mocked(getScript).mockResolvedValue(
      scriptResource({ actions: { can_generate: false, can_edit: false, can_approve: false } }),
    );
    const { screen } = await renderTab(contentItem({ status: 'in_check' }));
    await expect
      .element(screen.getByText('This script is locked while the item is in check.'))
      .toBeVisible();
    await expect.element(screen.getByLabelText('Hook')).toBeDisabled();
    await expect.element(screen.getByRole('button', { name: 'Regenerate' })).toBeDisabled();
    await expect.element(screen.getByRole('button', { name: 'Approve script' })).toBeDisabled();
    await expect.element(screen.getByRole('button', { name: 'History' })).toBeEnabled();
  });

  it('disables the editor while another job runs, with its message', async () => {
    const item = contentItem({
      status: 'in_production',
      active_job: {
        id: 'job-9',
        kind: 'production.start',
        status: 'running',
        progress: 10,
        message: 'Rendering frames',
      },
    });
    const { screen } = await renderTab(item);
    await expect.element(screen.getByLabelText('Hook')).toBeDisabled();
    const regenerate = screen.getByRole('button', { name: 'Regenerate' });
    await expect.element(regenerate).toBeDisabled();
    await regenerate.hover({ force: true });
    await expect.element(page.getByText('Rendering frames')).toBeVisible();
  });

  it('shows one frame card and no shots, durations or transitions for a feed post', async () => {
    vi.mocked(getScript).mockResolvedValue(scriptResource({ payload: feedPostPackage() }));
    const item = contentItem({ format: 'feed_post', media_kind: 'image', production_mode: 'design' });
    const { screen } = await renderTab(item);
    await expect.element(screen.getByLabelText('Headline')).toHaveValue('Daily posting is not the goal.');
    expect(screen.getByLabelText(/preview$/).elements()).toHaveLength(1);
    await expect.element(screen.getByText('Shots', { exact: true })).not.toBeInTheDocument();
    await expect.element(screen.getByLabelText('Duration')).not.toBeInTheDocument();
    await expect.element(screen.getByLabelText('Transition')).not.toBeInTheDocument();
    await expect.element(screen.getByLabelText('Music hint')).not.toBeInTheDocument();
  });

  it('shows Persian text right to left in the frame preview', async () => {
    const payload = reelMotionPackage();
    payload.frames[0].headline = 'هر روز پست گذاشتن راز رشد نیست';
    vi.mocked(getScript).mockResolvedValue(scriptResource({ payload }));
    const { screen } = await renderTab();
    const text = screen.getByLabelText('Frame 1 preview').getByText('هر روز پست گذاشتن راز رشد نیست');
    await expect.element(text).toBeVisible();
    expect(getComputedStyle(text.element()).direction).toBe('rtl');
  });
});

const versions: ScriptVersionEntry[] = [3, 2, 1].map((version) => ({
  version,
  status: version === 3 ? 'draft' : 'superseded',
  origin: version === 2 ? 'human' : 'ai',
  source: 'operator',
  feedback: version === 3 ? 'Open with a question.' : '',
  brief_version: 1,
  is_latest: version === 3,
  valid: true,
  summary: { hook: `Hook ${version}`, frame_count: 5, shot_count: 5, duration_seconds: 30 },
  created_by: { id: 3, name: 'Sara Ahmadi' },
  created_at: '2026-12-01T09:20:05Z',
}));

describe('Script tab: history and restore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFormats).mockResolvedValue(formatsResponse);
    vi.mocked(getBrief).mockResolvedValue({ brief: { cta: 'Save the checklist' } } as never);
    vi.mocked(getScript).mockResolvedValue(scriptResource({ version: 3, latest_version: 3 }));
    vi.mocked(listScriptVersions).mockResolvedValue({
      count: 3,
      next: null,
      previous: null,
      results: versions,
    });
    vi.mocked(getScriptVersion).mockResolvedValue(
      scriptResource({
        version: 1,
        latest_version: 3,
        status: 'superseded',
        payload: { ...reelMotionPackage(), hook: 'The very first hook' },
        actions: { can_generate: false, can_edit: false, can_approve: false },
      }),
    );
  });

  it('lists versions and restores an old one as a new draft', async () => {
    const success = vi.spyOn(message, 'success');
    vi.mocked(saveScript).mockResolvedValue(
      scriptResource({ version: 4, latest_version: 4, origin: 'human' }),
    );
    const { screen } = await renderTab();
    await screen.getByRole('button', { name: 'History' }).click();
    await expect.element(page.getByText('Script history')).toBeVisible();
    await expect.element(page.getByText('Current', { exact: true })).toBeVisible();
    await expect.element(page.getByText('Open with a question.')).toBeVisible();
    await page.getByRole('button', { name: 'Version 1' }).click();
    await expect.element(screen.getByText(/You are viewing version 1 from/)).toBeVisible();
    await expect.element(screen.getByLabelText('Hook')).toHaveValue('The very first hook');
    await expect.element(screen.getByLabelText('Hook')).toBeDisabled();
    await screen.getByRole('button', { name: 'Restore this version' }).click();
    await expect
      .element(
        page.getByText(
          'Create version 4 with the content of version 1? It will be a draft and needs approval.',
        ),
      )
      .toBeVisible();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await vi.waitFor(() => expect(success).toHaveBeenCalledWith('Restored as version 4.'));
    expect(saveScript).toHaveBeenCalledWith(42, {
      base_version: 3,
      note: 'Restored from version 1',
      payload: expect.objectContaining({ hook: 'The very first hook' }),
    });
    await expect.element(screen.getByText(/You are viewing version/)).not.toBeInTheDocument();
  });

  it('says so when the restored content is already current', async () => {
    const info = vi.spyOn(message, 'info');
    vi.mocked(saveScript).mockResolvedValue(
      scriptResource({ version: 3, latest_version: 3, unchanged: true }),
    );
    const { screen } = await renderTab();
    await screen.getByRole('button', { name: 'History' }).click();
    await page.getByRole('button', { name: 'Version 1' }).click();
    await screen.getByRole('button', { name: 'Restore this version' }).click();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await vi.waitFor(() =>
      expect(info).toHaveBeenCalledWith('Version 3 is already the current content.'),
    );
  });

  it('keeps history readable but restore disabled while the item is locked', async () => {
    vi.mocked(getScript).mockResolvedValue(
      scriptResource({
        version: 3,
        latest_version: 3,
        actions: { can_generate: false, can_edit: false, can_approve: false },
      }),
    );
    const { screen } = await renderTab(contentItem({ status: 'in_review' }));
    await screen.getByRole('button', { name: 'History' }).click();
    await page.getByRole('button', { name: 'Version 1' }).click();
    const restore = screen.getByRole('button', { name: 'Restore this version' });
    await expect.element(restore).toBeDisabled();
    await restore.hover({ force: true });
    await expect
      .element(page.getByRole('tooltip').getByText('This script is locked while the item is in review.'))
      .toBeVisible();
  });
});
