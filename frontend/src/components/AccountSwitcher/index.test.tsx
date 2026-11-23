import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';

const { state, setCurrentAccount } = vi.hoisted(() => ({
  state: { accounts: [] as any[], current: null as number | null },
  setCurrentAccount: vi.fn(),
}));

vi.mock('@umijs/max', () => ({
  useModel: () => ({
    accounts: state.accounts,
    currentAccountId: state.current,
    setCurrentAccount,
    loading: false,
  }),
}));

import AccountSwitcher from './index';

describe('AccountSwitcher (rule 19)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.accounts = [
      { id: 1, handle: 'alpha.cafe', display_name: 'Alpha Cafe' },
      { id: 2, handle: 'zeta.shop', display_name: 'Zeta Shop' },
    ];
    state.current = 1;
  });

  it('shows the current account by handle', async () => {
    const screen = await render(<AccountSwitcher />);
    await expect.element(screen.getByText('@alpha.cafe')).toBeInTheDocument();
  });

  it('switches through the account model', async () => {
    const screen = await render(<AccountSwitcher />);
    await screen.getByRole('combobox', { name: 'Instagram account' }).click();
    await screen.getByText('@zeta.shop').click();
    expect(setCurrentAccount).toHaveBeenCalledWith(2);
  });

  it('is disabled with "No accounts" when there are none', async () => {
    state.accounts = [];
    state.current = null;
    const screen = await render(<AccountSwitcher />);
    await expect.element(screen.getByText('No accounts')).toBeInTheDocument();
    await expect
      .element(screen.getByRole('combobox', { name: 'Instagram account' }))
      .toBeDisabled();
  });
});
