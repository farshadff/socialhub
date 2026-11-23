import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';

const { state } = vi.hoisted(() => ({ state: { account: null as any } }));

vi.mock('@umijs/max', () => ({
  Link: ({ to, children, ...rest }: any) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useModel: () => ({ currentAccount: state.account }),
}));

import { ConnectionIndicator, PublishingIndicator } from './index';

const account = (overrides: Record<string, unknown>) => ({
  id: 3,
  publishing_enabled: true,
  connection_status: 'connected',
  ...overrides,
});

describe('top-bar indicators (rule 23)', () => {
  beforeEach(() => {
    state.account = null;
  });

  it('shows a red "Publishing off" tag linking to Automation (acceptance 6)', async () => {
    state.account = account({ publishing_enabled: false });
    const screen = await render(<PublishingIndicator />);
    const tag = screen.getByText('Publishing off');
    await expect.element(tag).toBeInTheDocument();
    expect(tag.element().className).toMatch(/ant-tag-error|ant-tag-red/);
    expect(tag.element().closest('a')?.getAttribute('href')).toBe(
      '/settings/accounts/3?tab=automation',
    );
  });

  it('shows "Publishing on" when publishing is enabled', async () => {
    state.account = account({});
    const screen = await render(<PublishingIndicator />);
    await expect.element(screen.getByText('Publishing on')).toBeInTheDocument();
  });

  it('shows an orange "Needs attention" tag linking to Connection (acceptance 14)', async () => {
    state.account = account({ connection_status: 'needs_attention' });
    const screen = await render(<ConnectionIndicator />);
    const tag = screen.getByText('Needs attention');
    await expect.element(tag).toBeInTheDocument();
    expect(tag.element().closest('a')?.getAttribute('href')).toBe(
      '/settings/accounts/3?tab=connection',
    );
  });

  it('hides the connection tag when connected and both tags without an account', async () => {
    state.account = account({ connection_status: 'connected' });
    const connected = await render(<ConnectionIndicator />);
    expect(connected.container.textContent).toBe('');
    state.account = null;
    const none = await render(
      <>
        <ConnectionIndicator />
        <PublishingIndicator />
      </>,
    );
    expect(none.container.textContent).toBe('');
  });
});
