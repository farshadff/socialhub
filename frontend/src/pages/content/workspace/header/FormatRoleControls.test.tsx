import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { listPlanSlots, updateContentItem } from '@/services/socialhub/content';
import { getFormats } from '@/services/socialhub/formats';
import {
  apiError,
  item,
  modelFor,
  page1,
  registry,
  slot,
  withQueryClient,
} from '../tabs/brief/testFixtures';
import FormatRoleControls from './FormatRoleControls';

vi.mock('@umijs/max', () => ({
  useModel: (name: string) => modelFor(name),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
  history: {},
}));
vi.mock('@/services/socialhub/formats', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/formats')>()),
  getFormats: vi.fn(),
}));
vi.mock('@/services/socialhub/content', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/content')>()),
  listPlanSlots: vi.fn(),
  updateContentItem: vi.fn(),
}));

describe('FormatRoleControls (E04-S02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFormats).mockResolvedValue(registry);
    vi.mocked(listPlanSlots).mockImplementation(async (_plan, params) => {
      const all = [
        slot({ id: 207, scheduled_at: '2099-11-28T06:30:00Z', role: 'attract' }),
        slot({ id: 205, scheduled_at: '2099-11-29T06:30:00Z', role: 'educate' }),
      ];
      return page1(all.filter((s) => !params?.format || params.format.includes(s.format)));
    });
  });

  it('hides the edit button without edit_format and explains the lock past production', async () => {
    const screen = await render(
      withQueryClient(
        <FormatRoleControls item={item({ status: 'in_production', allowed_actions: [] })} reload={vi.fn()} />,
      ),
    );
    expect(screen.container.querySelector('button')).toBeNull();
    await expect
      .element(page.getByLabelText('Format is fixed once production starts'))
      .toBeInTheDocument();
  });

  it('switching a briefed reel to Story requires a slot, pre-selects a matching one and warns (criterion 12)', async () => {
    const reload = vi.fn();
    vi.mocked(updateContentItem).mockResolvedValue({
      ...item({ format: 'story', status: 'selected' }),
      effects: {
        status_from: 'briefed',
        status_to: 'selected',
        superseded: { briefs: [1], scripts: [] },
        released_slot: { id: 101, status: 'open' },
        reserved_slot: { id: 205 },
      },
    });
    await render(withQueryClient(<FormatRoleControls item={item()} reload={reload} />));
    await page.getByRole('button', { name: 'Edit format and role' }).click();
    const dialog = page.getByRole('dialog');
    await expect.element(dialog.getByText('Format and role')).toBeVisible();

    await dialog.getByText('Story', { exact: true }).click();
    await expect
      .element(
        dialog.getByText(
          'The brief (v1) and any script will be replaced. A new brief is written automatically.',
        ),
      )
      .toBeVisible();
    // The educate slot (205) is chosen over the earlier attract slot (207).
    await expect.element(dialog.getByText('Educate').last()).toBeVisible();

    await dialog.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('button', { name: 'Replace and save' }).click();
    await vi.waitFor(() => expect(updateContentItem).toHaveBeenCalled());
    expect(vi.mocked(updateContentItem).mock.calls[0][1]).toEqual({
      format: 'story',
      media_kind: 'image',
      production_mode: 'design',
      slot: 205,
      confirm: true,
    });
    await vi.waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it('closes on job_in_progress with the wait message', async () => {
    vi.mocked(updateContentItem).mockRejectedValue(
      apiError(409, { code: 'job_in_progress', details: { job: { id: 'j' } } }),
    );
    const reload = vi.fn();
    await render(withQueryClient(<FormatRoleControls item={item()} reload={reload} />));
    await page.getByRole('button', { name: 'Edit format and role' }).click();
    await page.getByRole('dialog').getByText('Engage', { exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await page.getByRole('button', { name: 'Replace and save' }).click();
    await expect.element(page.getByText('Wait for the running step to finish.')).toBeVisible();
  });

  it('opens when the shell sends a new open request', async () => {
    const client = new QueryClient();
    const reload = vi.fn();
    const screen = await render(
      withQueryClient(<FormatRoleControls item={item()} reload={reload} openRequest={0} />, client),
    );
    await screen.rerender(
      withQueryClient(<FormatRoleControls item={item()} reload={reload} openRequest={1} />, client),
    );
    await expect.element(page.getByRole('dialog').getByText('Format and role')).toBeVisible();
  });
});
