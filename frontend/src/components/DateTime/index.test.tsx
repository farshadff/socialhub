import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';

vi.mock('@umijs/max', () => ({
  useModel: () => ({
    currentAccount: { timezone: 'Asia/Tehran' },
    currentAccountId: 1,
    loading: false,
  }),
}));

import DateTime, { formatDateTime } from './index';

describe('DateTime (rule 28)', () => {
  it('shows account-timezone time (acceptance 8)', async () => {
    const screen = await render(<DateTime value="2026-11-22T09:00:00Z" />);
    // Tehran is UTC+3:30.
    await expect
      .element(screen.getByText('22 Nov 2026, 12:30'))
      .toBeInTheDocument();
  });

  it('shows the UTC value and timezone name in the tooltip', async () => {
    const screen = await render(<DateTime value="2026-11-22T09:00:00Z" />);
    await screen.getByText('22 Nov 2026, 12:30').hover();
    await expect
      .element(screen.getByText('22 Nov 2026, 09:00 UTC · Asia/Tehran'))
      .toBeInTheDocument();
  });

  it('formats date and time only, and in UTC when asked', () => {
    expect(formatDateTime('2026-11-22T21:00:00Z', 'Asia/Tehran', 'date')).toBe(
      '23 Nov 2026',
    );
    expect(formatDateTime('2026-11-22T09:05:00Z', 'UTC', 'time')).toBe('09:05');
  });

  it('renders "—" for a null value', async () => {
    const screen = await render(<DateTime value={null} />);
    await expect.element(screen.getByText('—')).toBeInTheDocument();
  });
});
