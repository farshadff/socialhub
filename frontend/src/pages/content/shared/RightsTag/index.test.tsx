import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import RightsTag, { expiryText } from './index';

describe('RightsTag', () => {
  it.each([
    ['cleared', 'Cleared', 'ant-tag-success'],
    ['unknown', 'Unknown', 'ant-tag-warning'],
    ['restricted', 'Restricted', 'ant-tag-error'],
    ['expired', 'Expired', 'ant-tag-error'],
  ] as const)(
    'shows %s as "%s" in the status colour',
    async (status, label, className) => {
      const screen = await render(<RightsTag status={status} />);
      const tag = screen.getByText(label);
      await expect.element(tag).toBeInTheDocument();
      expect(tag.element().closest('.ant-tag')?.className).toContain(className);
    },
  );

  it('shows the licence note and expiry date in the tooltip', async () => {
    const screen = await render(
      <RightsTag
        status="cleared"
        licenseNote="Licence #A-2231, social use"
        expiresAt="2099-11-01"
      />,
    );
    await screen.getByText('Cleared').hover();
    await expect
      .element(page.getByText('Licence note: Licence #A-2231, social use'))
      .toBeVisible();
    await expect.element(page.getByText('Expires on 1 Nov 2099')).toBeVisible();
  });

  it('says when there is no note or expiry', () => {
    expect(expiryText(null)).toBe('No expiry date');
    expect(expiryText('2020-01-02')).toBe('Expired on 2 Jan 2020');
  });
});
