import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { listAssets } from '@/services/socialhub/assets';
import type { ContentItemDetail } from '@/services/socialhub/content';
import { getFormats } from '@/services/socialhub/formats';
import { getJob } from '@/services/socialhub/jobs';
import {
  getBrand,
  getProduction,
  listRenderTemplates,
  type Production,
  startProduction,
  submitVersion,
} from '@/services/socialhub/production';
import { BLOCKER_TEXT, versionLabel } from './shared';
import ProductionTab from './index';
import {
  apiError,
  contentItem,
  formatsResponse,
  modelFor,
  noVersion,
  page as pageOf,
  production,
  templates,
  withQueryClient,
} from './testFixtures';

vi.mock('@umijs/max', () => ({
  useModel: (name: string) => modelFor(name),
  Link: ({ to, children }: any) => <a href={to}>{children}</a>,
  history: {},
}));
vi.mock('@/services/socialhub/production', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/production')>()),
  getProduction: vi.fn(),
  getBrand: vi.fn(),
  listRenderTemplates: vi.fn(),
  startProduction: vi.fn(),
  submitVersion: vi.fn(),
  renderProduction: vi.fn(),
}));
vi.mock('@/services/socialhub/formats', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/formats')>()),
  getFormats: vi.fn(),
}));
vi.mock('@/services/socialhub/assets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/assets')>()),
  listAssets: vi.fn(),
}));
vi.mock('@/services/socialhub/jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/jobs')>()),
  getJob: vi.fn(),
}));

async function renderTab(item: ContentItemDetail, resource: Production) {
  vi.mocked(getProduction).mockResolvedValue(resource);
  const props = {
    item,
    reload: vi.fn(),
    switchTab: vi.fn(),
    openFormatModal: vi.fn(),
  };
  const screen = await render(withQueryClient(<ProductionTab {...props} />));
  return { ...props, screen };
}

describe('Production tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFormats).mockResolvedValue(formatsResponse);
    vi.mocked(getBrand).mockRejectedValue(apiError(404, { code: 'not_found' }));
    vi.mocked(listRenderTemplates).mockResolvedValue(pageOf(templates));
    vi.mocked(listAssets).mockResolvedValue(pageOf([]));
    vi.mocked(getJob).mockResolvedValue({
      id: 'job-1',
      kind: 'production.start',
      status: 'running',
      progress: 5,
      message: 'Version 1 prepared',
    } as never);
  });

  it('offers Start production when a scripted item has no version yet', async () => {
    vi.mocked(startProduction).mockResolvedValue({
      job: {
        id: 'job-1',
        kind: 'production.start',
        status: 'queued',
        progress: 5,
        message: 'Version 1 prepared',
      } as never,
    });
    const { screen, reload } = await renderTab(
      contentItem({ status: 'scripted' }),
      noVersion(),
    );
    await expect
      .element(screen.getByText('Production has not started.'))
      .toBeInTheDocument();
    await screen.getByRole('button', { name: 'Start production' }).click();
    await vi.waitFor(() =>
      expect(startProduction).toHaveBeenCalledWith(42, false),
    );
    await vi.waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it('points a briefed item to the script or to "Use my own file"', async () => {
    const { screen, switchTab } = await renderTab(
      contentItem({ status: 'briefed' }),
      noVersion({ actions: { ...production().actions, can_start: false } }),
    );
    await expect
      .element(
        screen.getByText(
          'Approve the script to start production, or use your own file.',
        ),
      )
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole('button', { name: 'Use my own file' }))
      .toBeInTheDocument();
    await screen.getByRole('button', { name: 'Open the script' }).click();
    expect(switchTab).toHaveBeenCalledWith('script');
  });

  it('shows an older version read-only, without actions', async () => {
    const current = production();
    const older = production({
      version: 1,
      is_current: false,
      actions: {
        can_start: false,
        can_render: false,
        can_edit_frames: false,
        can_edit_copy: false,
        can_upload_final: false,
        can_submit: false,
        submit_blockers: ['not_current'],
        holding_warnings: [],
      },
    });
    vi.mocked(getProduction).mockImplementation(async (_id, version) =>
      version === 1 ? older : current,
    );
    const props = {
      item: contentItem(),
      reload: vi.fn(),
      switchTab: vi.fn(),
      openFormatModal: vi.fn(),
    };
    const screen = await render(withQueryClient(<ProductionTab {...props} />));
    await expect
      .element(screen.getByRole('button', { name: 'Submit for checking' }))
      .toBeInTheDocument();

    await screen.getByRole('combobox', { name: 'Version' }).click();
    await page
      .getByText(
        versionLabel({ version: 1, status: 'draft', is_current: false }),
      )
      .click();

    await expect
      .element(screen.getByText('You are viewing version 1. It is read-only.'))
      .toBeInTheDocument();
    expect(getProduction).toHaveBeenCalledWith(42, 1);
    await expect
      .element(screen.getByRole('button', { name: 'Submit for checking' }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole('button', { name: 'Use my own file' }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByLabelText('Caption')).toBeDisabled();

    await screen.getByText('Back to the current version').click();
    await expect
      .element(screen.getByRole('button', { name: 'Submit for checking' }))
      .toBeInTheDocument();
  });

  it('disables Submit and lists the blockers in words', async () => {
    const { screen } = await renderTab(
      contentItem(),
      production({
        render_status: 'pending',
        actions: {
          ...production().actions,
          can_submit: false,
          submit_blockers: ['caption_missing', 'not_rendered'],
        },
      }),
    );
    const submit = screen.getByRole('button', { name: 'Submit for checking' });
    await expect.element(submit).toBeDisabled();
    await screen.getByTestId('submit-wrapper').hover();
    await expect
      .element(page.getByText(BLOCKER_TEXT.caption_missing))
      .toBeVisible();
    await expect
      .element(page.getByText('Render the changed frames first'))
      .toBeVisible();
    expect(BLOCKER_TEXT.caption_missing).toBe('Write a caption first');
  });

  it('asks to acknowledge holding warnings, then submits and opens the Checks tab', async () => {
    vi.mocked(submitVersion).mockResolvedValue({} as never);
    const { screen, reload, switchTab } = await renderTab(
      contentItem(),
      production({
        render_warnings: [
          { code: 'text_overflow', frame_index: 2, message: 'Body overflows.' },
        ],
        actions: {
          ...production().actions,
          holding_warnings: ['text_overflow'],
        },
      }),
    );
    await screen.getByRole('button', { name: 'Submit for checking' }).click();
    await expect
      .element(page.getByText('Submit version 3 for checking?'))
      .toBeInTheDocument();
    await expect
      .element(
        page.getByText(
          "The five checks start right away. This version can't be edited after it is submitted.",
        ),
      )
      .toBeInTheDocument();
    await expect
      .element(
        page
          .getByRole('dialog')
          .getByText(
            'Frame 2: Text does not fit. Shorten it or choose another template.',
          ),
      )
      .toBeInTheDocument();
    await page.getByRole('button', { name: 'Submit anyway' }).click();
    await vi.waitFor(() =>
      expect(submitVersion).toHaveBeenCalledWith(42, {
        base_version: 3,
        acknowledge_warnings: true,
      }),
    );
    await vi.waitFor(() => expect(switchTab).toHaveBeenCalledWith('checks'));
    expect(reload).toHaveBeenCalled();
  });

  it('submits without acknowledgement when there are no holding warnings', async () => {
    vi.mocked(submitVersion).mockResolvedValue({} as never);
    const { screen } = await renderTab(contentItem(), production());
    await screen.getByRole('button', { name: 'Submit for checking' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Submit for checking' })
      .click();
    await vi.waitFor(() =>
      expect(submitVersion).toHaveBeenCalledWith(42, {
        base_version: 3,
        acknowledge_warnings: false,
      }),
    );
  });

  it('reloads with the conflict message on 409 version_conflict', async () => {
    vi.mocked(submitVersion).mockRejectedValue(
      apiError(409, {
        code: 'version_conflict',
        details: { latest_version: 4 },
      }),
    );
    const { screen } = await renderTab(contentItem(), production());
    const before = vi.mocked(getProduction).mock.calls.length;
    await screen.getByRole('button', { name: 'Submit for checking' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Submit for checking' })
      .click();
    await expect
      .element(page.getByText('This item changed. Reloading.'))
      .toBeInTheDocument();
    await vi.waitFor(() =>
      expect(vi.mocked(getProduction).mock.calls.length).toBeGreaterThan(
        before,
      ),
    );
  });

  it('disables actions while production is running', async () => {
    const { screen } = await renderTab(
      contentItem({
        active_job: {
          id: 'job-1',
          kind: 'production.start',
          status: 'running',
          progress: 40,
          message: 'Rendering frame 2 of 4',
        },
      }),
      production({
        production_steps: {
          ...production().production_steps,
          frames: { status: 'running' },
        },
      }),
    );
    await expect
      .element(screen.getByRole('button', { name: 'Submit for checking' }))
      .toBeDisabled();
    await expect
      .element(screen.getByRole('button', { name: 'Use my own file' }))
      .toBeDisabled();
    await expect.element(screen.getByText('Rendering…')).toBeInTheDocument();
  });

  it('shows the waiting-for-backgrounds and failed alerts', async () => {
    const { screen } = await renderTab(
      contentItem(),
      production({
        frames: [
          production().frames[0],
          {
            ...production().frames[1],
            state: 'pending',
            warnings: [{ code: 'background_required' }],
          },
        ],
        production_steps: {
          ...production().production_steps,
          assemble: { status: 'failed', error_code: 'assembly_failed' },
        },
      }),
    );
    await expect
      .element(
        screen.getByText(
          'Frame 2 needs an image. Open the frame and choose or generate one, then re-render.',
        ),
      )
      .toBeInTheDocument();
    await expect
      .element(
        screen.getByText(
          'Production stopped at assemble: The video could not be assembled. Try again.',
        ),
      )
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole('button', { name: 'Resume production' }))
      .toBeInTheDocument();
  });
});
