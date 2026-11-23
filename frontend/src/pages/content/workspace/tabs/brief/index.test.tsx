import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import {
  approveBrief,
  generateBrief,
  getBrief,
  listBriefVersions,
  saveBrief,
} from '@/services/socialhub/briefs';
import {
  type ContentItemDetail,
  getPlanForContent,
  listContentEvents,
} from '@/services/socialhub/content';
import { getFormats } from '@/services/socialhub/formats';
import { getJob } from '@/services/socialhub/jobs';
import BriefTab from './index';
import {
  apiError,
  brief,
  briefResource,
  item,
  modelFor,
  page1,
  registry,
  withQueryClient,
} from './testFixtures';

vi.mock('@umijs/max', () => ({
  useModel: (name: string) => modelFor(name),
  history: {},
}));
vi.mock('@/services/socialhub/briefs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/briefs')>()),
  getBrief: vi.fn(),
  listBriefVersions: vi.fn(),
  generateBrief: vi.fn(),
  saveBrief: vi.fn(),
  approveBrief: vi.fn(),
}));
vi.mock('@/services/socialhub/content', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/content')>()),
  getPlanForContent: vi.fn(),
  listContentEvents: vi.fn(),
}));
vi.mock('@/services/socialhub/formats', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/formats')>()),
  getFormats: vi.fn(),
}));
vi.mock('@/services/socialhub/jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/jobs')>()),
  getJob: vi.fn(),
}));

async function renderTab(it0: ContentItemDetail = item()) {
  const props = { item: it0, reload: vi.fn(), switchTab: vi.fn(), openFormatModal: vi.fn() };
  const screen = await render(withQueryClient(<BriefTab {...props} />));
  return { ...props, screen };
}

describe('Brief tab (E04-S03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFormats).mockResolvedValue(registry);
    vi.mocked(getPlanForContent).mockResolvedValue({
      id: 12,
      title: 'Week of 28 Nov',
      week_start: '2026-11-28',
      status: 'active',
      success_metrics: ['reach', 'shares'],
    });
    vi.mocked(getBrief).mockResolvedValue(briefResource());
    vi.mocked(listBriefVersions).mockResolvedValue(page1([brief(), brief({ version: 1, status: 'approved' })]));
    vi.mocked(listContentEvents).mockResolvedValue(page1([]));
    vi.mocked(getJob).mockResolvedValue({ id: 'j', status: 'running', progress: 0, message: '' } as never);
  });

  it('offers to generate or write by hand when there is no brief', async () => {
    vi.mocked(getBrief).mockResolvedValue(briefResource({ brief: null, latest_version: 0 }));
    vi.mocked(generateBrief).mockResolvedValue({ job: { id: 'j' } as never });
    const { reload } = await renderTab(item({ status: 'selected', current_brief: null }));
    await expect.element(page.getByText('No brief yet.')).toBeVisible();
    await page.getByRole('button', { name: 'Generate brief' }).click();
    await vi.waitFor(() => expect(generateBrief).toHaveBeenCalledWith(42, {}));
    expect(reload).toHaveBeenCalled();
  });

  it('disables "Write by hand" until the item has a role', async () => {
    vi.mocked(getBrief).mockResolvedValue(briefResource({ brief: null, latest_version: 0 }));
    await renderTab(item({ status: 'selected', role: null, current_brief: null }));
    await expect.element(page.getByRole('button', { name: 'Write by hand' })).toBeDisabled();
  });

  it('shows the brief with its header, warnings and pending-draft note', async () => {
    vi.mocked(getBrief).mockResolvedValue(briefResource({ warnings: ['metric_not_in_plan'] }));
    await renderTab();
    await expect.element(page.getByText('Brief v2')).toBeVisible();
    await expect.element(page.getByText('Waiting for approval').first()).toBeVisible();
    await expect
      .element(page.getByText("Success metric Saves is not one of this week's success metrics (Reach, Shares)."))
      .toBeVisible();
    await expect
      .element(page.getByText('Version 2 is waiting for approval. Until then the script uses approved version 1.'))
      .toBeVisible();
    await expect.element(page.getByText('(default for this role)')).toBeVisible();
    await expect.element(page.getByText('example.org')).toBeVisible();
  });

  it('confirms before approving a brief of a scripted item', async () => {
    vi.mocked(approveBrief).mockResolvedValue(briefResource({ item_status: 'briefed' }));
    await renderTab(item({ status: 'scripted' }));
    await page.getByRole('button', { name: 'Approve brief' }).click();
    await expect
      .element(page.getByText('The approved script will be replaced and written again.'))
      .toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Approve brief' }).click();
    await vi.waitFor(() => expect(approveBrief).toHaveBeenCalledWith(42, 2));
    await expect.element(page.getByText('Brief approved')).toBeVisible();
  });

  it('lists validation problems and blocks approval', async () => {
    vi.mocked(getBrief).mockResolvedValue(
      briefResource({
        validation: {
          valid: false,
          issues: [
            { code: 'text_too_long', path: 'key_message', message: 'Key message is 236 characters; the limit is 200.' },
          ],
        },
        actions: { can_generate: true, can_edit: true, can_approve: false },
      }),
    );
    await renderTab();
    await expect
      .element(page.getByText('1 problem must be fixed before this brief can be approved.'))
      .toBeVisible();
    expect(page.getByRole('button', { name: 'Approve brief' }).all()).toHaveLength(0);
  });

  it('is read-only past production', async () => {
    vi.mocked(getBrief).mockResolvedValue(
      briefResource({ actions: { can_generate: false, can_edit: false, can_approve: false } }),
    );
    await renderTab(item({ status: 'in_check', allowed_actions: [] }));
    await expect.element(page.getByText('The brief is locked because production has started.')).toBeVisible();
    expect(page.getByRole('button', { name: 'Edit' }).all()).toHaveLength(0);
    expect(page.getByRole('button', { name: 'Regenerate' }).all()).toHaveLength(0);
  });

  it('puts a rejected reference URL under its field', async () => {
    vi.mocked(saveBrief).mockRejectedValue(
      apiError(400, {
        code: 'validation_error',
        fields: [{ path: 'references.0.url', code: 'invalid_url', message: 'Enter a valid URL.' }],
      }),
    );
    await renderTab();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabelText('Call to action').fill('Save this tonight.');
    await page.getByRole('button', { name: 'Save as new version' }).click();
    await vi.waitFor(() => expect(saveBrief).toHaveBeenCalled());
    expect(vi.mocked(saveBrief).mock.calls[0][1]).toMatchObject({ base_version: 2, cta: 'Save this tonight.' });
    await expect.element(page.getByText('Enter a valid URL.')).toBeVisible();
  });

  it('explains a version conflict on save and names the author', async () => {
    vi.mocked(saveBrief).mockRejectedValue(
      apiError(409, {
        code: 'version_conflict',
        details: { latest_version: 3, latest_origin: 'human', latest_created_by: { id: 4, name: 'Reza' } },
      }),
    );
    await renderTab();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabelText('Audience').fill('Remote workers.');
    await page.getByRole('button', { name: 'Save as new version' }).click();
    await expect
      .element(page.getByText('Version 3 was written by Reza while you were editing.'))
      .toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Keep editing' })).toBeVisible();
  });

  it('asks before leaving edit mode with unsaved changes', async () => {
    await renderTab();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabelText('Audience').fill('Remote workers.');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect.element(page.getByText('You have unsaved changes. Leave without saving?')).toBeVisible();
  });

  it('shows the failed-job alert with both ways forward', async () => {
    vi.mocked(getBrief).mockResolvedValue(briefResource({ brief: null, latest_version: 0 }));
    vi.mocked(listContentEvents).mockResolvedValue(
      page1([
        {
          id: 1,
          type: 'job_failed',
          from_status: null,
          to_status: null,
          actor: null,
          message: '',
          data: { kind: 'brief.generate', error_code: 'provider_not_configured' },
          created_at: '2026-11-22T09:21:40Z',
        },
      ]),
    );
    await renderTab(
      item({
        status: 'selected',
        current_brief: null,
        hold_reason: 'Brief could not be written (provider_not_configured). Try again or write it by hand.',
      }),
    );
    await expect.element(page.getByText(/The brief could not be written: A required integration/)).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Write by hand' })).toBeEnabled();
  });

  it('opens the format modal from the role "Change" link', async () => {
    const { openFormatModal } = await renderTab();
    await page.getByText('Change', { exact: true }).click();
    expect(openFormatModal).toHaveBeenCalled();
  });
});
