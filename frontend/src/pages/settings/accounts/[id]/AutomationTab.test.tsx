import { notification } from 'antd';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { type Account, updateAccount } from '@/services/socialhub/accounts';
import {
  apiError,
  TEST_ACCOUNT,
  testModel,
  withQueryClient,
} from '@/utils/testing';
import AutomationTab, { CONNECT_FIRST, OPERATOR_NOTE } from './AutomationTab';

const state = vi.hoisted(() => ({
  access: 'admin' as 'admin' | 'operator',
  refreshAccounts: vi.fn(),
}));

vi.mock('@umijs/max', () => ({
  useModel: (name: string) =>
    testModel(name, {
      access: state.access,
      refreshAccounts: state.refreshAccounts,
    }),
  history: { block: () => () => undefined },
}));
vi.mock('@/services/socialhub/accounts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/accounts')>()),
  updateAccount: vi.fn(),
}));

const account = (overrides: Partial<Account> = {}): Account => ({
  ...TEST_ACCOUNT,
  ...overrides,
});

describe('AutomationTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    state.access = 'admin';
  });

  it('disables publishing with a tooltip while the account is not connected (acceptance 5)', async () => {
    const screen = await render(
      withQueryClient(
        <AutomationTab
          account={account({ connection_status: 'disconnected' })}
        />,
      ),
    );
    const toggle = screen.getByRole('switch', { name: 'Publish to Instagram' });
    await expect.element(toggle).toBeDisabled();
    await screen.getByTestId('publishing-switch').hover();
    await expect.element(page.getByText(CONNECT_FIRST)).toBeVisible();
  });

  it('asks before turning publishing on, saves, and refreshes the account model', async () => {
    const saved = account({
      connection_status: 'connected',
      publishing_enabled: true,
    });
    vi.mocked(updateAccount).mockResolvedValue(saved);
    const screen = await render(
      withQueryClient(
        <AutomationTab account={account({ connection_status: 'connected' })} />,
      ),
    );
    await screen.getByRole('switch', { name: 'Publish to Instagram' }).click();
    await expect
      .element(page.getByText('Turn on publishing for @greenhome.ir?'))
      .toBeVisible();
    expect(updateAccount).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'Turn on publishing' }).click();
    await vi.waitFor(() =>
      expect(updateAccount).toHaveBeenCalledWith(1, {
        publishing_enabled: true,
      }),
    );
    await vi.waitFor(() => expect(state.refreshAccounts).toHaveBeenCalled());
  });

  it('saves one autopilot switch as a partial update (acceptance 8)', async () => {
    vi.mocked(updateAccount).mockResolvedValue(
      account({ autopilot: { selection: false, brief: true, script: false } }),
    );
    const screen = await render(
      withQueryClient(<AutomationTab account={account()} />),
    );
    await screen
      .getByRole('switch', { name: 'Approve briefs automatically' })
      .click();
    await vi.waitFor(() =>
      expect(updateAccount).toHaveBeenCalledWith(1, {
        autopilot: { brief: true },
      }),
    );
  });

  it('shows a posting rule error under its field (acceptance 7)', async () => {
    vi.spyOn(notification, 'error');
    vi.mocked(updateAccount).mockRejectedValue(
      apiError(400, {
        code: 'validation_error',
        fields: [
          {
            path: 'posting_rules.min_gap_minutes',
            code: 'min_value',
            message: '…',
          },
        ],
      }),
    );
    const screen = await render(
      withQueryClient(<AutomationTab account={account()} />),
    );
    await screen.getByRole('button', { name: 'Save rules' }).click();
    await expect
      .element(screen.getByText('This is below the minimum.'))
      .toBeVisible();
    expect(notification.error).not.toHaveBeenCalled();
  });

  it('is read-only for operators', async () => {
    state.access = 'operator';
    const screen = await render(
      withQueryClient(
        <AutomationTab account={account({ connection_status: 'connected' })} />,
      ),
    );
    await expect.element(screen.getByText(OPERATOR_NOTE)).toBeVisible();
    await expect
      .element(screen.getByRole('switch', { name: 'Publish to Instagram' }))
      .toBeDisabled();
    await expect
      .element(
        screen.getByRole('switch', { name: 'Confirm selection automatically' }),
      )
      .toBeDisabled();
    expect(screen.container.textContent).not.toContain('Save rules');
  });
});
