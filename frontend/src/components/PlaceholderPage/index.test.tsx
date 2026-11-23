import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';

const { state } = vi.hoisted(() => ({
  state: {
    access: 'admin',
    account: null as any,
    loading: false,
    error: null as unknown,
  },
}));

vi.mock('@umijs/max', () => ({
  Link: ({ to, children }: any) => <a href={to}>{children}</a>,
  useModel: (name: string) =>
    name === 'account'
      ? {
          accounts: state.account ? [state.account] : [],
          currentAccount: state.account,
          currentAccountId: state.account?.id ?? null,
          loading: state.loading,
          error: state.error,
          refreshAccounts: vi.fn(),
        }
      : { initialState: { currentUser: { access: state.access } } },
}));

import PlaceholderPage from './index';

describe('PlaceholderPage and AccountGate', () => {
  beforeEach(() => {
    state.access = 'admin';
    state.account = null;
    state.loading = false;
    state.error = null;
  });

  it('shows the story that builds the page', async () => {
    state.account = { id: 1 };
    const screen = await render(
      <PlaceholderPage title="Calendar" story="E08-S02" />,
    );
    await expect
      .element(screen.getByText('This page arrives with E08-S02.'))
      .toBeInTheDocument();
  });

  it('asks an admin to add the first account (acceptance 5)', async () => {
    const screen = await render(
      <PlaceholderPage title="Weekly plan" story="E01-S01" />,
    );
    await expect
      .element(
        screen.getByText('Add your first Instagram account to get started.'),
      )
      .toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Add account' });
    await expect.element(link).toHaveAttribute('href', '/settings/accounts');
  });

  it('tells an operator to ask an admin, without a button', async () => {
    state.access = 'operator';
    const screen = await render(
      <PlaceholderPage title="Weekly plan" story="E01-S01" />,
    );
    await expect
      .element(
        screen.getByText(
          'No Instagram account is set up yet. Ask an admin to add one.',
        ),
      )
      .toBeInTheDocument();
    expect(screen.getByText('Add account').elements()).toHaveLength(0);
  });

  it('shows the error with Retry when accounts failed to load', async () => {
    state.error = new Error('boom');
    const screen = await render(
      <PlaceholderPage title="Weekly plan" story="E01-S01" />,
    );
    await expect
      .element(screen.getByRole('button', { name: 'Retry' }))
      .toBeInTheDocument();
  });

  it('does not gate pages that are not account-scoped', async () => {
    const screen = await render(
      <PlaceholderPage title="Accounts" story="E00-S03" accountScoped={false} />,
    );
    await expect
      .element(screen.getByText('This page arrives with E00-S03.'))
      .toBeInTheDocument();
  });
});
