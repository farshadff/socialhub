import { Button } from 'antd';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { createAccount } from '@/services/socialhub/accounts';
import { apiError, TEST_ACCOUNT, testModel } from '@/utils/testing';
import AddAccountModal from './AddAccountModal';

const state = vi.hoisted(() => ({
  refreshAccounts: vi.fn(),
  setCurrentAccount: vi.fn(),
  push: vi.fn(),
}));

vi.mock('@umijs/max', () => ({
  useModel: (name: string) =>
    testModel(name, {
      refreshAccounts: state.refreshAccounts,
      setCurrentAccount: state.setCurrentAccount,
    }),
  history: { push: state.push },
}));
vi.mock('@/services/socialhub/accounts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/accounts')>()),
  createAccount: vi.fn(),
}));

async function openAndFill() {
  const screen = await render(
    <AddAccountModal trigger={<Button>Add account</Button>} />,
  );
  await screen.getByRole('button', { name: 'Add account' }).click();
  await page.getByLabelText('Instagram handle').fill('@GreenHome.ir');
  await page.getByLabelText('Display name').fill('Green Home');
  return screen;
}

describe('AddAccountModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.refreshAccounts.mockResolvedValue(undefined);
  });

  it('adds the account, selects it and opens its Brand tab', async () => {
    vi.mocked(createAccount).mockResolvedValue({ ...TEST_ACCOUNT, id: 7 });
    await openAndFill();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Add account' })
      .click();
    await vi.waitFor(() =>
      expect(state.push).toHaveBeenCalledWith('/settings/accounts/7?tab=brand'),
    );
    expect(createAccount).toHaveBeenCalledWith({
      handle: 'greenhome.ir',
      display_name: 'Green Home',
      timezone: TEST_ACCOUNT.timezone,
      content_language: 'fa',
      week_start_day: 5,
    });
    expect(state.refreshAccounts).toHaveBeenCalled();
    expect(state.setCurrentAccount).toHaveBeenCalledWith(7);
  });

  it('shows "This is already in use." under the handle (acceptance 2)', async () => {
    vi.mocked(createAccount).mockRejectedValue(
      apiError(400, {
        code: 'validation_error',
        fields: [{ path: 'handle', code: 'unique', message: '…' }],
      }),
    );
    await openAndFill();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Add account' })
      .click();
    await expect
      .element(page.getByText('This is already in use.'))
      .toBeVisible();
    expect(state.push).not.toHaveBeenCalled();
  });
});
